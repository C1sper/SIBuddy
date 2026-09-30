// services/categoriesService.js
// Catégories de devoirs, propres à chaque serveur et gérables depuis le panel
// d'administration (plus aucune catégorie codée en dur).
//
// Chaque catégorie possède un ID stable (`cat_xxxxxx`) indépendant de son nom :
// renommer "Projet" en "Projet de groupe" ne touche aucun devoir existant.
// Les devoirs référencent `categoryId`, jamais le nom.
//
// `legacySlug` conserve la correspondance avec l'ancien champ `type`
// (devoir/examen/projet) : il permet la migration déterministe et l'écriture
// d'un miroir `type` dans les devoirs, pour qu'un retour arrière reste possible.
const { FILES, readGuildJson, writeGuildJson } = require('./guildStore');

const NAME_MAX_LENGTH = 40;
const EMOJI_MAX_LENGTH = 64;
const MAX_CATEGORIES = 25; // borne d'un select menu Discord

/**
 * Catégories créées automatiquement pour tout nouveau serveur.
 * Correspondent aux 3 types historiques du bot.
 */
function defaultCategories() {
  return [
    { name: 'Devoir', emoji: '📚', legacySlug: 'devoir' },
    { name: 'Examen', emoji: '📝', legacySlug: 'examen' },
    { name: 'Projet', emoji: '🚧', legacySlug: 'projet' },
  ].map((cat, index) => ({
    id: makeCategoryId(),
    name: cat.name,
    emoji: cat.emoji,
    enabled: true,
    order: index,
    legacySlug: cat.legacySlug,
    createdAt: new Date().toISOString(),
  }));
}

function makeCategoryId() {
  const random = Math.random().toString(16).slice(2, 8).padEnd(6, '0');
  return `cat_${random}`;
}

function makeUniqueCategoryId(existing) {
  const taken = new Set(existing.map(c => c.id));
  let id = makeCategoryId();
  while (taken.has(id)) id = makeCategoryId();
  return id;
}

// ---------------------------------------------------------------------------
// Normalisation / persistance
// ---------------------------------------------------------------------------

function normalizeCategory(raw, index) {
  if (!raw || typeof raw !== 'object') return null;

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;
  const name = String(raw.name ?? '').trim();
  if (!id || !name) return null;

  const order = Number(raw.order);

  return {
    id,
    name: name.slice(0, NAME_MAX_LENGTH),
    emoji: typeof raw.emoji === 'string' && raw.emoji.trim() ? raw.emoji.trim().slice(0, EMOJI_MAX_LENGTH) : null,
    enabled: raw.enabled !== false,
    order: Number.isFinite(order) ? order : index,
    legacySlug: typeof raw.legacySlug === 'string' && raw.legacySlug ? raw.legacySlug : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
  };
}

/** Réécrit les `order` en 0..n-1 après tri, pour rester compact et stable. */
function resequence(list) {
  return list
    .slice()
    .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'fr'))
    .map((cat, index) => ({ ...cat, order: index }));
}

/**
 * Lit les catégories d'un serveur. Si le serveur n'en a pas encore, crée et
 * persiste les catégories par défaut (initialisation paresseuse : aucun appel
 * explicite n'est nécessaire ailleurs dans le code).
 */
function listCategories(guildId, { enabledOnly = false } = {}) {
  const raw = readGuildJson(guildId, FILES.CATEGORIES, null);

  let categories;
  if (!raw || !Array.isArray(raw.categories)) {
    categories = defaultCategories();
    writeCategories(guildId, categories);
  } else {
    categories = resequence(raw.categories.map(normalizeCategory).filter(Boolean));
  }

  // Un serveur sans aucune catégorie exploitable retombe sur les valeurs par défaut :
  // sinon plus aucun devoir ne pourrait être créé.
  if (categories.length === 0) {
    categories = defaultCategories();
    writeCategories(guildId, categories);
  }

  return enabledOnly ? categories.filter(c => c.enabled) : categories;
}

function writeCategories(guildId, categories) {
  return writeGuildJson(guildId, FILES.CATEGORIES, {
    version: 2,
    categories: resequence(categories.map(normalizeCategory).filter(Boolean)),
  });
}

// ---------------------------------------------------------------------------
// Résolution
// ---------------------------------------------------------------------------

function getCategory(guildId, categoryId) {
  if (!categoryId) return null;
  return listCategories(guildId).find(c => c.id === String(categoryId)) || null;
}

/**
 * Résout une référence libre vers une catégorie : ID stable, ancien slug
 * (devoir/examen/projet) ou nom (insensible à la casse). Indispensable pour
 * rester tolérant aux anciennes données et aux saisies manuelles en modal.
 */
function resolveCategory(guildId, ref) {
  if (ref === null || ref === undefined) return null;
  const needle = String(ref).trim();
  if (!needle) return null;

  const categories = listCategories(guildId);
  const lower = needle.toLowerCase();

  return (
    categories.find(c => c.id === needle) ||
    categories.find(c => c.legacySlug && c.legacySlug.toLowerCase() === lower) ||
    categories.find(c => c.name.toLowerCase() === lower) ||
    null
  );
}

/** Catégorie utilisée par défaut quand rien n'est fourni ou que la référence est perdue. */
function getFallbackCategory(guildId) {
  const enabled = listCategories(guildId, { enabledOnly: true });
  if (enabled.length > 0) return enabled[0];
  const all = listCategories(guildId);
  return all[0] || null;
}

/** Libellé d'affichage : "📚 Devoir" ou "Devoir" si aucun emoji. */
function formatCategory(category) {
  if (!category) return 'Sans catégorie';
  return category.emoji ? `${category.emoji} ${category.name}` : category.name;
}

/**
 * Choix d'autocomplétion Discord pour les catégories d'un serveur.
 * - au maximum 25 résultats (limite Discord)
 * - filtrage insensible à la casse sur ce que tape l'utilisateur
 * - la valeur renvoyée est l'ID stable, jamais le nom
 */
function buildAutocompleteChoices(guildId, focused, { enabledOnly = true } = {}) {
  const needle = String(focused || '').trim().toLowerCase();

  return listCategories(guildId, { enabledOnly })
    .filter(c => !needle || c.name.toLowerCase().includes(needle))
    .slice(0, 25)
    .map(c => ({ name: formatCategory(c).slice(0, 100), value: c.id }));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Une séquence emoji peut combiner pictogrammes, indicateurs régionaux
// (drapeaux 🇫🇷), modificateurs de teinte, ZWJ (👨‍💻), variation selectors
// et keycaps (1️⃣). On accepte cet alphabet, puis on exige qu'au moins un
// caractère soit réellement un pictogramme ou un indicateur régional —
// sinon "123" passerait pour un emoji.
const EMOJI_ALPHABET_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\p{Emoji_Component}|‍|️|⃣)+$/u;
const EMOJI_CORE_RE = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣)/u;
// Emoji personnalisé Discord : <:nom:id> ou <a:nom:id> (animé).
const DISCORD_EMOJI_RE = /^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/;

function isEmojiLike(value) {
  if (DISCORD_EMOJI_RE.test(value)) return true;
  // Borne le nombre de points de code : un "emoji" de 30 caractères casserait l'affichage.
  if ([...value].length > 16) return false;
  return EMOJI_ALPHABET_RE.test(value) && EMOJI_CORE_RE.test(value);
}

function validateName(name, { categories = [], excludeId = null } = {}) {
  const value = String(name ?? '').replace(/\s+/g, ' ').trim();

  if (!value) return { ok: false, error: 'Le nom de la catégorie est requis.' };
  if (value.length > NAME_MAX_LENGTH) {
    return { ok: false, error: `Le nom ne doit pas dépasser ${NAME_MAX_LENGTH} caractères.` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    return { ok: false, error: 'Le nom contient des caractères invalides.' };
  }

  const duplicate = categories.some(
    c => c.id !== excludeId && c.name.toLowerCase() === value.toLowerCase(),
  );
  if (duplicate) return { ok: false, error: `La catégorie **${value}** existe déjà.` };

  return { ok: true, value };
}

function validateEmoji(emoji) {
  const value = String(emoji ?? '').trim();
  if (!value) return { ok: true, value: null }; // l'emoji est facultatif
  if (value.length > EMOJI_MAX_LENGTH) return { ok: false, error: 'Emoji trop long.' };
  if (isEmojiLike(value)) return { ok: true, value };
  return {
    ok: false,
    error: 'Emoji invalide. Utilise un seul emoji (ex : 🎤) ou laisse le champ vide.',
  };
}

// ---------------------------------------------------------------------------
// Opérations (utilisées par le panel ET par la migration)
// ---------------------------------------------------------------------------

function addCategory(guildId, { name, emoji } = {}) {
  const categories = listCategories(guildId);

  if (categories.length >= MAX_CATEGORIES) {
    return { ok: false, error: `Limite atteinte : ${MAX_CATEGORIES} catégories maximum par serveur.` };
  }

  const nameCheck = validateName(name, { categories });
  if (!nameCheck.ok) return nameCheck;

  const emojiCheck = validateEmoji(emoji);
  if (!emojiCheck.ok) return emojiCheck;

  const category = {
    id: makeUniqueCategoryId(categories),
    name: nameCheck.value,
    emoji: emojiCheck.value,
    enabled: true,
    order: categories.length,
    legacySlug: null,
    createdAt: new Date().toISOString(),
  };

  writeCategories(guildId, [...categories, category]);
  return { ok: true, category };
}

function updateCategory(guildId, categoryId, { name, emoji } = {}) {
  const categories = listCategories(guildId);
  const index = categories.findIndex(c => c.id === String(categoryId));
  if (index === -1) return { ok: false, error: 'Cette catégorie n’existe plus.' };

  const nameCheck = validateName(name, { categories, excludeId: categories[index].id });
  if (!nameCheck.ok) return nameCheck;

  const emojiCheck = validateEmoji(emoji);
  if (!emojiCheck.ok) return emojiCheck;

  // L'ID stable et le legacySlug ne sont jamais modifiés.
  const updated = { ...categories[index], name: nameCheck.value, emoji: emojiCheck.value };
  categories[index] = updated;
  writeCategories(guildId, categories);

  return { ok: true, category: updated };
}

function setCategoryEnabled(guildId, categoryId, enabled) {
  const categories = listCategories(guildId);
  const index = categories.findIndex(c => c.id === String(categoryId));
  if (index === -1) return { ok: false, error: 'Cette catégorie n’existe plus.' };

  const next = Boolean(enabled);

  // Toujours garder au moins une catégorie active, sinon plus aucun devoir
  // ne peut être créé sur le serveur.
  if (!next && categories.filter(c => c.enabled && c.id !== categories[index].id).length === 0) {
    return { ok: false, error: 'Impossible : il doit rester au moins une catégorie active.' };
  }

  categories[index] = { ...categories[index], enabled: next };
  writeCategories(guildId, categories);
  return { ok: true, category: categories[index] };
}

function toggleCategory(guildId, categoryId) {
  const category = getCategory(guildId, categoryId);
  if (!category) return { ok: false, error: 'Cette catégorie n’existe plus.' };
  return setCategoryEnabled(guildId, categoryId, !category.enabled);
}

/**
 * Compte les devoirs (actifs + archivés) rattachés à une catégorie.
 * Lecture brute volontaire : évite un cycle de require avec devoirsService.
 */
function countCategoryUsage(guildId, categoryId) {
  const id = String(categoryId);
  const countIn = (list) =>
    (Array.isArray(list) ? list : []).filter(d => d && String(d.categoryId) === id).length;

  return {
    active: countIn(readGuildJson(guildId, FILES.DEVOIRS, [])),
    archived: countIn(readGuildJson(guildId, FILES.ARCHIVES, [])),
  };
}

/** Réattribue tous les devoirs (actifs + archivés) d'une catégorie vers une autre. */
function reassignCategory(guildId, fromCategoryId, toCategoryId) {
  const from = getCategory(guildId, fromCategoryId);
  const to = getCategory(guildId, toCategoryId);

  if (!from) return { ok: false, error: 'Catégorie source introuvable.' };
  if (!to) return { ok: false, error: 'Catégorie de destination introuvable.' };
  if (from.id === to.id) return { ok: false, error: 'Choisis une catégorie de destination différente.' };

  let moved = 0;
  for (const fileName of [FILES.DEVOIRS, FILES.ARCHIVES]) {
    const list = readGuildJson(guildId, fileName, []);
    if (!Array.isArray(list)) continue;

    let changed = false;
    for (const item of list) {
      if (!item || String(item.categoryId) !== from.id) continue;
      item.categoryId = to.id;
      item.type = to.legacySlug || to.id; // miroir legacy, gardé synchrone
      moved++;
      changed = true;
    }
    if (changed) writeGuildJson(guildId, fileName, list);
  }

  return { ok: true, moved, from, to };
}

/**
 * Supprime une catégorie. Refuse tant qu'elle est référencée par un devoir
 * (actif ou archivé) : aucune référence orpheline n'est jamais laissée.
 */
function deleteCategory(guildId, categoryId) {
  const categories = listCategories(guildId);
  const category = categories.find(c => c.id === String(categoryId));
  if (!category) return { ok: false, error: 'Cette catégorie n’existe plus.' };

  if (categories.length <= 1) {
    return { ok: false, error: 'Impossible de supprimer la dernière catégorie du serveur.' };
  }

  const usage = countCategoryUsage(guildId, category.id);
  const total = usage.active + usage.archived;
  if (total > 0) {
    return {
      ok: false,
      inUse: true,
      usage,
      error:
        `Cette catégorie est utilisée par ${total} devoir(s) ` +
        `(${usage.active} actif(s), ${usage.archived} archivé(s)). ` +
        'Tu dois d’abord réattribuer ces devoirs à une autre catégorie.',
    };
  }

  writeCategories(guildId, categories.filter(c => c.id !== category.id));
  return { ok: true, category };
}

/** Déplace une catégorie d'un cran vers le haut ('up') ou le bas ('down'). */
function moveCategory(guildId, categoryId, direction) {
  const categories = listCategories(guildId); // déjà trié + resequencé
  const index = categories.findIndex(c => c.id === String(categoryId));
  if (index === -1) return { ok: false, error: 'Cette catégorie n’existe plus.' };

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= categories.length) {
    return { ok: false, error: 'La catégorie est déjà à cette extrémité.' };
  }

  [categories[index], categories[target]] = [categories[target], categories[index]];
  writeCategories(guildId, categories.map((c, i) => ({ ...c, order: i })));

  return { ok: true, category: categories[target] };
}

module.exports = {
  NAME_MAX_LENGTH,
  EMOJI_MAX_LENGTH,
  MAX_CATEGORIES,
  defaultCategories,
  makeCategoryId,
  listCategories,
  writeCategories,
  getCategory,
  resolveCategory,
  getFallbackCategory,
  formatCategory,
  buildAutocompleteChoices,
  validateName,
  validateEmoji,
  addCategory,
  updateCategory,
  setCategoryEnabled,
  toggleCategory,
  countCategoryUsage,
  reassignCategory,
  deleteCategory,
  moveCategory,
};
