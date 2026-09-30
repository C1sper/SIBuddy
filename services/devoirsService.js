// services/devoirsService.js
// Service métier des devoirs / examens / projets, scopé par serveur Discord.
//
// C'est la SEULE porte d'entrée pour créer, modifier, supprimer ou archiver un
// devoir : la commande slash et le panel d'administration appellent exactement
// les mêmes fonctions (pas de logique dupliquée entre les deux).
//
// Schéma d'un devoir (v2) :
// {
//   id: "hw_xxx" | 1764094551334,   // ID stable, jamais réécrit
//   guildId, channelId,
//   matiere: "Cryptographie",        // NOUVEAU (peut être vide)
//   titre: "TP RSA",
//   date: "2026-09-12",
//   heure: "14:30" | null,           // NOUVEAU (facultatif)
//   description: "",
//   categoryId: "cat_a84f92",        // référence stable vers categories.json
//   type: "devoir",                  // miroir legacy du legacySlug, tenu à jour
//   importance: "faible|important|tres_important",
//   customTimings: [{ label, offsetMs }],
//   createdAt, updatedAt
// }
const { FILES, readGuildJson, writeGuildJson, listGuildIds, normalizeGuildId } = require('./guildStore');
const { getDevoirsConfig, patchDevoirsConfig } = require('./guildConfig');
const { parseDateYYYYMMDD, parseDateTimeLocal } = require('./dateParser');
const categoriesService = require('./categoriesService');
const remindersStore = require('./remindersStore');

const IMPORTANCE_LABELS = {
  faible: 'Peu important',
  important: 'Important',
  tres_important: 'Très important',
};
const VALID_IMPORTANCES = Object.keys(IMPORTANCE_LABELS);

// Heure appliquée quand aucune n'est saisie. Les devoirs héritant du schéma v1
// gardent `heure: null` en base : le défaut est résolu À LA LECTURE, on ne
// réécrit jamais les données existantes.
const DEFAULT_HEURE = '00:00';

const TITRE_MAX_LENGTH = 100;
const MATIERE_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Identifiants
// ---------------------------------------------------------------------------

/**
 * Génère un ID de devoir stable et sans collision.
 * (Les anciens IDs numériques `Date.now()` restent valides : toutes les
 * comparaisons se font en String, aucun remapping n'est nécessaire.)
 */
function makeDevoirId() {
  return `hw_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function sameId(a, b) {
  return String(a) === String(b);
}

// ---------------------------------------------------------------------------
// Normalisation / lecture / écriture
// ---------------------------------------------------------------------------

function normalizeDevoir(raw, guildId) {
  if (!raw || typeof raw !== 'object') return null;

  const heure = typeof raw.heure === 'string' && /^\d{2}:\d{2}$/.test(raw.heure.trim())
    ? raw.heure.trim()
    : null;

  return {
    id: raw.id ?? makeDevoirId(),
    guildId: raw.guildId || guildId || null,
    channelId: raw.channelId || null,
    matiere: typeof raw.matiere === 'string' ? raw.matiere.trim().slice(0, MATIERE_MAX_LENGTH) : '',
    titre: String(raw.titre ?? '').slice(0, TITRE_MAX_LENGTH),
    date: typeof raw.date === 'string' ? raw.date.trim() : '',
    heure,
    description: typeof raw.description === 'string' ? raw.description.slice(0, DESCRIPTION_MAX_LENGTH) : '',
    categoryId: raw.categoryId ? String(raw.categoryId) : null,
    type: typeof raw.type === 'string' ? raw.type : null,
    importance: VALID_IMPORTANCES.includes(raw.importance) ? raw.importance : 'important',
    customTimings: Array.isArray(raw.customTimings) ? raw.customTimings : [],
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

function readDevoirs(guildId) {
  const list = readGuildJson(guildId, FILES.DEVOIRS, []);
  if (!Array.isArray(list)) return [];
  return list.map(d => normalizeDevoir(d, guildId)).filter(Boolean);
}

function writeDevoirs(guildId, list) {
  return writeGuildJson(guildId, FILES.DEVOIRS, list);
}

function readArchive(guildId) {
  const list = readGuildJson(guildId, FILES.ARCHIVES, []);
  if (!Array.isArray(list)) return [];
  return list.map(d => normalizeDevoir(d, guildId)).filter(Boolean);
}

function writeArchive(guildId, list) {
  return writeGuildJson(guildId, FILES.ARCHIVES, list);
}

// ---------------------------------------------------------------------------
// Configuration (façade : conserve la forme { [guildId]: config } attendue par
// /devoir-salon-liste, /devoir-salon-rappels, /devoir-mention-role-config
// et /devoir-timings, qui n'ont donc pas eu besoin d'être réécrites)
// ---------------------------------------------------------------------------

function getGuildConfig(guildId) {
  return getDevoirsConfig(guildId);
}

function readConfig() {
  const out = {};
  for (const guildId of listGuildIds()) out[guildId] = getDevoirsConfig(guildId);
  return out;
}

/**
 * Écrit la config devoirs de chaque serveur présent dans l'objet.
 * N'écrit que ce qui a réellement changé, pour ne pas réécrire (ni risquer
 * d'écraser avec une valeur périmée) la config des serveurs non touchés.
 */
function writeConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return;

  for (const [guildId, guildCfg] of Object.entries(cfg)) {
    if (!normalizeGuildId(guildId) || !guildCfg || typeof guildCfg !== 'object') continue;
    const current = getDevoirsConfig(guildId);
    if (JSON.stringify(current) === JSON.stringify(guildCfg)) continue;
    patchDevoirsConfig(guildId, guildCfg);
  }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Heure effective d'un devoir : celle qui a été saisie, ou minuit par défaut.
 * `heure: null` en base signifie donc "00:00", sans qu'on ait à réécrire les
 * anciens devoirs.
 */
function getEffectiveHeure(devoir) {
  const heure = devoir && typeof devoir.heure === 'string' ? devoir.heure.trim() : '';
  return /^\d{2}:\d{2}$/.test(heure) ? heure : DEFAULT_HEURE;
}

/**
 * Échéance d'un devoir : sa date à son heure effective.
 * Sert aux rappels, au tri, à l'archivage ET à l'affichage — une seule
 * définition, pour que le tableau ne puisse pas diverger de la logique métier.
 */
function getDeadline(devoir) {
  if (!devoir) return null;

  const withTime = parseDateTimeLocal(devoir.date, getEffectiveHeure(devoir));
  if (withTime) return withTime;

  // Repli si la date est lisible mais l'heure inexploitable.
  return parseDateYYYYMMDD(devoir.date);
}

/**
 * Horodatage utilisé pour l'affichage (tableau, embeds).
 * Identique à l'échéance : ce que voit l'étudiant est exactement la date
 * limite utilisée par les rappels.
 */
function getDisplayDate(devoir) {
  return getDeadline(devoir);
}

/**
 * Découpe une saisie libre "AAAA-MM-JJ" ou "AAAA-MM-JJ HH:mm" en ses deux
 * parties. Sert aux modals Discord, limités à 5 champs : on ne peut pas y
 * offrir une ligne séparée pour l'heure.
 */
function parseDateTimeInput(input) {
  const parts = String(input || '').trim().split(/\s+/);
  return { date: parts[0] || '', heure: parts[1] || null };
}

/** "12/09/2026 à 00:00" — rendu texte unique, partagé par toutes les vues. */
function formatEcheance(devoir) {
  if (!devoir || !devoir.date) return 'Non définie';
  return `${devoir.date} à ${getEffectiveHeure(devoir)}`;
}

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

/**
 * Retrouve la catégorie d'un devoir, en tolérant les données anciennes
 * (champ `type`) et les catégories supprimées entre-temps.
 */
function getDevoirCategory(guildId, devoir) {
  if (!devoir) return null;
  return (
    categoriesService.getCategory(guildId, devoir.categoryId) ||
    categoriesService.resolveCategory(guildId, devoir.type) ||
    null
  );
}

/** Applique une catégorie à un devoir et met à jour le miroir legacy `type`. */
function applyCategory(devoir, category) {
  devoir.categoryId = category ? category.id : null;
  devoir.type = category ? (category.legacySlug || category.id) : null;
  return devoir;
}

// ---------------------------------------------------------------------------
// Archivage
// ---------------------------------------------------------------------------

/** Déplace vers les archives les devoirs dont la date est passée (comparaison au jour). */
function movePastDevoirsToArchive(guildId) {
  const id = normalizeGuildId(guildId);
  if (!id) return 0;

  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const current = readDevoirs(id);
  const archived = readArchive(id);
  const alreadyIds = new Set(archived.map(d => String(d.id)));

  const stillCurrent = [];
  const toArchive = [];

  for (const devoir of current) {
    const day = parseDateYYYYMMDD(devoir.date);
    if (!day) {
      stillCurrent.push(devoir); // date illisible : on ne perd rien, on garde
      continue;
    }
    if (day.getTime() < todayMidnight) {
      if (!alreadyIds.has(String(devoir.id))) {
        toArchive.push({ ...devoir, archivedAt: new Date().toISOString() });
        alreadyIds.add(String(devoir.id));
      }
    } else {
      stillCurrent.push(devoir);
    }
  }

  if (toArchive.length > 0) {
    writeDevoirs(id, stillCurrent);
    writeArchive(id, [...archived, ...toArchive]);
    for (const devoir of toArchive) remindersStore.cancelByDevoirId(id, devoir.id);
  }

  return toArchive.length;
}

/** Archive manuellement un devoir encore actif. */
function archiveDevoir(guildId, devoirId) {
  const id = normalizeGuildId(guildId);
  if (!id) return { ok: false, error: 'Serveur invalide.' };

  const devoirs = readDevoirs(id);
  const target = devoirs.find(d => sameId(d.id, devoirId));
  if (!target) return { ok: false, error: 'Ce devoir n’existe plus.' };

  writeDevoirs(id, devoirs.filter(d => !sameId(d.id, devoirId)));
  writeArchive(id, [...readArchive(id), { ...target, archivedAt: new Date().toISOString() }]);
  const cancelledCount = remindersStore.cancelByDevoirId(id, target.id);

  return { ok: true, devoir: target, cancelledCount };
}

// ---------------------------------------------------------------------------
// Timings / rappels
// ---------------------------------------------------------------------------

/** Convertit "3j", "12h", "1h30", "45m" en millisecondes. */
function parseOffset(str) {
  if (!str) return null;
  const s = String(str).toLowerCase().replace(/\s+/g, '');

  let total = 0;
  const days = s.match(/(\d+)j/);
  if (days) total += parseInt(days[1], 10) * 24 * 60 * 60 * 1000;
  const hours = s.match(/(\d+)h/);
  if (hours) total += parseInt(hours[1], 10) * 60 * 60 * 1000;
  const mins = s.match(/(\d+)m/);
  if (mins) total += parseInt(mins[1], 10) * 60 * 1000;

  return total > 0 ? total : null;
}

function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';

  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  const parts = [];
  if (days) parts.push(`${days}j`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds) parts.push(`${seconds}s`);
  return parts.length === 0 ? '0s' : parts.join(' ');
}

function parseTimingsString(timingsStr) {
  const result = [];
  const trimmed = String(timingsStr || '').trim();
  if (!trimmed) return { timings: result, error: null };

  for (const part of trimmed.split(',').map(p => p.trim()).filter(Boolean)) {
    const off = parseOffset(part);
    if (!off) {
      return { timings: [], error: `Timing invalide : \`${part}\` (ex attendus : 3j, 12h, 45m, 1h30).` };
    }
    result.push({ label: part, offsetMs: off });
  }
  return { timings: result, error: null };
}

/** Génère les rappels persistants d'un devoir (J-7, J-1, timings guild + devoir). */
function buildRemindersForDevoir(devoir) {
  const guildId = normalizeGuildId(devoir?.guildId);
  if (!guildId) return [];

  const deadline = getDeadline(devoir);
  if (!deadline) return [];

  const sourceChannelId = devoir.channelId;
  if (!sourceChannelId) return [];

  const now = Date.now();
  const deadlineMs = deadline.getTime();
  const guildCfg = getDevoirsConfig(guildId);
  const category = getDevoirCategory(guildId, devoir);
  const reminders = [];

  const push = (kind, when) => {
    if (when.getTime() <= now) return;
    reminders.push({
      guildId,
      sourceChannelId,
      devoirId: devoir.id,
      kind,
      title: devoir.titre,
      matiere: devoir.matiere || '',
      categoryId: category ? category.id : null,
      type: devoir.type || null,
      importance: devoir.importance,
      date: devoir.date,
      heure: devoir.heure || null,
      description: devoir.description || '',
      remindAtISO: when.toISOString(),
    });
  };

  const d7 = new Date(deadline);
  d7.setDate(d7.getDate() - 7);
  d7.setHours(8, 0, 0, 0);
  push('7d', d7);

  const d1 = new Date(deadline);
  d1.setDate(d1.getDate() - 1);
  d1.setHours(8, 0, 0, 0);
  push('1d-morning', d1);

  const timings = [
    ...(Array.isArray(guildCfg.customTimings) ? guildCfg.customTimings : []),
    ...(Array.isArray(devoir.customTimings) ? devoir.customTimings : []),
  ];

  for (const t of timings) {
    if (!t || typeof t.offsetMs !== 'number') continue;
    const trigger = deadlineMs - t.offsetMs;
    if (trigger <= now) continue;
    push(`custom-${t.label || t.offsetMs}`, new Date(trigger));
  }

  return reminders;
}

/** Annule les rappels existants d'un devoir puis en recrée un jeu à jour. */
function rebuildRemindersFor(devoir) {
  const guildId = normalizeGuildId(devoir?.guildId);
  if (!guildId) return [];

  remindersStore.cancelByDevoirId(guildId, devoir.id);
  const reminders = buildRemindersForDevoir(devoir);
  if (reminders.length > 0) remindersStore.addMany(guildId, reminders);
  return reminders;
}

/** Recalcule tous les rappels de tous les serveurs (au démarrage du bot). */
function rebuildAllReminders() {
  let devoirsCount = 0;
  let createdCount = 0;

  for (const guildId of listGuildIds()) {
    movePastDevoirsToArchive(guildId);
    for (const devoir of readDevoirs(guildId)) {
      devoirsCount++;
      createdCount += rebuildRemindersFor(devoir).length;
    }
  }

  return { devoirsCount, createdCount };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateTitre(titre) {
  const t = String(titre || '').trim();
  if (!t) return { ok: false, error: 'Le titre est requis.' };
  if (t.length > TITRE_MAX_LENGTH) return { ok: false, error: `Le titre dépasse ${TITRE_MAX_LENGTH} caractères.` };
  return { ok: true, value: t };
}

function validateMatiere(matiere) {
  const m = String(matiere || '').trim();
  if (m.length > MATIERE_MAX_LENGTH) {
    return { ok: false, error: `La matière dépasse ${MATIERE_MAX_LENGTH} caractères.` };
  }
  return { ok: true, value: m };
}

function validateDescription(description) {
  const d = String(description || '').trim();
  if (d.length > DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: `La description dépasse ${DESCRIPTION_MAX_LENGTH} caractères.` };
  }
  return { ok: true, value: d };
}

function validateImportance(importance) {
  const v = importance || 'important';
  if (!VALID_IMPORTANCES.includes(v)) {
    return { ok: false, error: `Importance invalide (attendu : ${VALID_IMPORTANCES.join(', ')}).` };
  }
  return { ok: true, value: v };
}

function validateDate(dateStr) {
  const d = parseDateYYYYMMDD(String(dateStr || '').trim());
  if (!d) return { ok: false, error: 'Format de date invalide. Utilise le format **AAAA-MM-JJ**.' };
  return { ok: true, value: String(dateStr).trim() };
}

function validateHeure(heureStr) {
  const h = String(heureStr || '').trim();
  // Champ vide = on ne stocke rien ; getEffectiveHeure() appliquera minuit.
  if (!h) return { ok: true, value: null };
  if (!/^\d{2}:\d{2}$/.test(h)) {
    return { ok: false, error: 'Format d’heure invalide. Utilise **HH:mm** (ex : 14:30).' };
  }
  const [hh, mm] = h.split(':').map(Number);
  if (hh > 23 || mm > 59) return { ok: false, error: 'Heure invalide (00:00 à 23:59).' };
  return { ok: true, value: h };
}

/**
 * Valide une référence de catégorie POUR LA CRÉATION/MODIFICATION.
 * Ne fait jamais confiance à la valeur reçue de l'autocomplétion : on
 * revérifie que la catégorie existe, appartient à ce serveur, et est active.
 */
function validateCategory(guildId, ref, { allowDisabled = false } = {}) {
  if (ref === null || ref === undefined || String(ref).trim() === '') {
    const fallback = categoriesService.getFallbackCategory(guildId);
    if (!fallback) return { ok: false, error: 'Aucune catégorie disponible sur ce serveur.' };
    return { ok: true, value: fallback };
  }

  const category = categoriesService.resolveCategory(guildId, ref);
  if (!category) return { ok: false, error: 'Cette catégorie n’existe pas (ou plus) sur ce serveur.' };
  if (!category.enabled && !allowDisabled) {
    return { ok: false, error: `La catégorie **${category.name}** est désactivée : choisis-en une autre.` };
  }
  return { ok: true, value: category };
}

// ---------------------------------------------------------------------------
// Opérations de haut niveau (commande slash ET panel appellent celles-ci)
// ---------------------------------------------------------------------------

function addDevoir({
  guildId, channelId, matiere, titre, date, heure, description, categoryRef, importance, timingsStr,
} = {}) {
  const id = normalizeGuildId(guildId);
  if (!id) return { ok: false, error: 'Cette action doit être effectuée dans un serveur.' };

  const titreCheck = validateTitre(titre);
  if (!titreCheck.ok) return titreCheck;

  const matiereCheck = validateMatiere(matiere);
  if (!matiereCheck.ok) return matiereCheck;

  const dateCheck = validateDate(date);
  if (!dateCheck.ok) return dateCheck;

  const heureCheck = validateHeure(heure);
  if (!heureCheck.ok) return heureCheck;

  const categoryCheck = validateCategory(id, categoryRef);
  if (!categoryCheck.ok) return categoryCheck;

  const importanceCheck = validateImportance(importance);
  if (!importanceCheck.ok) return importanceCheck;

  const descCheck = validateDescription(description);
  if (!descCheck.ok) return descCheck;

  const { timings, error: timingsError } = parseTimingsString(timingsStr);
  if (timingsError) return { ok: false, error: timingsError };

  movePastDevoirsToArchive(id);

  const now = new Date().toISOString();
  const devoir = applyCategory({
    id: makeDevoirId(),
    guildId: id,
    channelId: channelId || null,
    matiere: matiereCheck.value,
    titre: titreCheck.value,
    date: dateCheck.value,
    heure: heureCheck.value,
    description: descCheck.value,
    categoryId: null,
    type: null,
    importance: importanceCheck.value,
    customTimings: timings,
    createdAt: now,
    updatedAt: now,
  }, categoryCheck.value);

  writeDevoirs(id, [...readDevoirs(id), devoir]);
  const remindersCreated = rebuildRemindersFor(devoir);

  return { ok: true, devoir, category: categoryCheck.value, remindersCreated };
}

/**
 * Modification complète d'un devoir. `patch` ne contient que les champs à
 * changer ; l'ID, la guild et la date de création ne bougent jamais.
 * Les rappels sont systématiquement reconstruits (les anciens sont annulés).
 */
function updateDevoir(guildId, devoirId, patch = {}) {
  const id = normalizeGuildId(guildId);
  if (!id) return { ok: false, error: 'Cette action doit être effectuée dans un serveur.' };

  const devoirs = readDevoirs(id);
  const index = devoirs.findIndex(d => sameId(d.id, devoirId));
  if (index === -1) return { ok: false, error: 'Ce devoir n’existe plus.' };

  const before = { ...devoirs[index] };
  const next = { ...devoirs[index] };

  if (patch.titre !== undefined) {
    const check = validateTitre(patch.titre);
    if (!check.ok) return check;
    next.titre = check.value;
  }

  if (patch.matiere !== undefined) {
    const check = validateMatiere(patch.matiere);
    if (!check.ok) return check;
    next.matiere = check.value;
  }

  if (patch.date !== undefined) {
    const check = validateDate(patch.date);
    if (!check.ok) return check;
    next.date = check.value;
  }

  if (patch.heure !== undefined) {
    const check = validateHeure(patch.heure);
    if (!check.ok) return check;
    next.heure = check.value;
  }

  if (patch.description !== undefined) {
    const check = validateDescription(patch.description);
    if (!check.ok) return check;
    next.description = check.value;
  }

  if (patch.importance !== undefined) {
    const check = validateImportance(patch.importance);
    if (!check.ok) return check;
    next.importance = check.value;
  }

  let category = getDevoirCategory(id, next);
  if (patch.categoryRef !== undefined) {
    // On autorise de reposer une catégorie désactivée uniquement si c'est
    // déjà celle du devoir (on ne bloque pas l'édition d'un vieux devoir).
    const check = validateCategory(id, patch.categoryRef, {
      allowDisabled: categoriesService.resolveCategory(id, patch.categoryRef)?.id === before.categoryId,
    });
    if (!check.ok) return check;
    category = check.value;
    applyCategory(next, category);
  }

  next.updatedAt = new Date().toISOString();
  devoirs[index] = next;
  writeDevoirs(id, devoirs);

  const reminders = rebuildRemindersFor(next);

  return { ok: true, devoir: next, before, category, reminders };
}

/** Compat : modification de la seule date (utilisée par /modifier-date-devoir). */
function updateDevoirDate(guildId, devoirId, newDateStr) {
  const devoirs = readDevoirs(guildId);
  const target = devoirs.find(d => sameId(d.id, devoirId));
  const oldDate = target ? target.date : null;

  const result = updateDevoir(guildId, devoirId, { date: newDateStr });
  if (!result.ok) return result;
  return { ...result, oldDate };
}

function deleteDevoir(guildId, devoirId) {
  const id = normalizeGuildId(guildId);
  if (!id) return { ok: false, error: 'Cette action doit être effectuée dans un serveur.' };

  const devoirs = readDevoirs(id);
  const target = devoirs.find(d => sameId(d.id, devoirId));
  if (!target) return { ok: false, error: 'Ce devoir n’existe plus.' };

  writeDevoirs(id, devoirs.filter(d => !sameId(d.id, devoirId)));
  const cancelledCount = remindersStore.cancelByDevoirId(id, target.id);

  return { ok: true, devoir: target, cancelledCount };
}

function addCustomTiming(guildId, devoirId, label, delaiStr) {
  const id = normalizeGuildId(guildId);
  if (!id) return { ok: false, error: 'Cette action doit être effectuée dans un serveur.' };

  const off = parseOffset(delaiStr);
  if (!off) return { ok: false, error: `Délai invalide : \`${delaiStr}\` (ex attendus : 3j, 12h, 45m, 1h30).` };

  const cleanLabel = String(label || '').trim().slice(0, 50);
  if (!cleanLabel) return { ok: false, error: 'Le libellé du timing est requis.' };

  const devoirs = readDevoirs(id);
  const index = devoirs.findIndex(d => sameId(d.id, devoirId));
  if (index === -1) return { ok: false, error: 'Ce devoir n’existe plus.' };

  devoirs[index].customTimings = [...(devoirs[index].customTimings || []), { label: cleanLabel, offsetMs: off }];
  devoirs[index].updatedAt = new Date().toISOString();
  writeDevoirs(id, devoirs);

  return { ok: true, devoir: devoirs[index], reminders: rebuildRemindersFor(devoirs[index]) };
}

function removeCustomTiming(guildId, devoirId, timingIndex) {
  const id = normalizeGuildId(guildId);
  if (!id) return { ok: false, error: 'Cette action doit être effectuée dans un serveur.' };

  const devoirs = readDevoirs(id);
  const index = devoirs.findIndex(d => sameId(d.id, devoirId));
  if (index === -1) return { ok: false, error: 'Ce devoir n’existe plus.' };

  const timings = Array.isArray(devoirs[index].customTimings) ? devoirs[index].customTimings : [];
  if (!timings[timingIndex]) return { ok: false, error: 'Ce timing n’existe plus.' };

  const [removed] = timings.splice(timingIndex, 1);
  devoirs[index].customTimings = timings;
  devoirs[index].updatedAt = new Date().toISOString();
  writeDevoirs(id, devoirs);

  return { ok: true, devoir: devoirs[index], removed, reminders: rebuildRemindersFor(devoirs[index]) };
}

// ---------------------------------------------------------------------------
// Lectures ordonnées
// ---------------------------------------------------------------------------

function importanceScore(imp) {
  if (imp === 'tres_important') return 2;
  if (imp === 'important') return 1;
  return 0;
}

/** Liste triée par importance décroissante puis échéance croissante (vues "liste"). */
function listDevoirs({ guildId, categoryId } = {}) {
  let devoirs = readDevoirs(guildId);
  if (categoryId) devoirs = devoirs.filter(d => String(d.categoryId) === String(categoryId));

  return devoirs.sort((a, b) => {
    const impDiff = importanceScore(b.importance) - importanceScore(a.importance);
    if (impDiff !== 0) return impDiff;
    return compareChronologically(a, b);
  });
}

/** Comparateur chronologique stable : date, puis heure, puis matière, puis titre. */
function compareChronologically(a, b) {
  const da = getDeadline(a);
  const db = getDeadline(b);
  if (da && db) {
    const diff = da.getTime() - db.getTime();
    if (diff !== 0) return diff;
  } else if (da || db) {
    return da ? -1 : 1; // les dates illisibles passent en dernier
  }

  const matiereDiff = (a.matiere || '').localeCompare(b.matiere || '', 'fr');
  if (matiereDiff !== 0) return matiereDiff;

  const titreDiff = (a.titre || '').localeCompare(b.titre || '', 'fr');
  if (titreDiff !== 0) return titreDiff;

  return String(a.id).localeCompare(String(b.id)); // dernier recours : ordre totalement stable
}

/** Devoirs à venir (aujourd'hui inclus), triés chronologiquement — utilisé par le tableau. */
function getUpcoming(guildId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  return readDevoirs(guildId)
    .filter(d => {
      const day = parseDateYYYYMMDD(d.date);
      return day && day.getTime() >= todayMs;
    })
    .sort(compareChronologically);
}

function listArchived(guildId) {
  return readArchive(guildId).sort((a, b) => compareChronologically(b, a)); // plus récent d'abord
}

module.exports = {
  IMPORTANCE_LABELS,
  VALID_IMPORTANCES,
  DEFAULT_HEURE,
  TITRE_MAX_LENGTH,
  MATIERE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,

  makeDevoirId,
  sameId,
  normalizeDevoir,

  readDevoirs,
  writeDevoirs,
  readArchive,
  writeArchive,
  readConfig,
  writeConfig,
  getGuildConfig,

  getDeadline,
  getDisplayDate,
  getEffectiveHeure,
  formatEcheance,
  parseDateTimeInput,
  getDevoirCategory,

  movePastDevoirsToArchive,
  archiveDevoir,

  parseOffset,
  formatDuration,
  parseTimingsString,
  buildRemindersForDevoir,
  rebuildRemindersFor,
  rebuildAllReminders,

  validateTitre,
  validateMatiere,
  validateDescription,
  validateImportance,
  validateDate,
  validateHeure,
  validateCategory,

  addDevoir,
  updateDevoir,
  updateDevoirDate,
  deleteDevoir,
  addCustomTiming,
  removeCustomTiming,

  listDevoirs,
  listArchived,
  getUpcoming,
  compareChronologically,
};
