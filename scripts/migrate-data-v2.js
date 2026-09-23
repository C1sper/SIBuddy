#!/usr/bin/env node
// scripts/migrate-data-v2.js
//
// Migration des données du bot : schéma v1 (fichiers à plat dans data/)
// vers le schéma v2 (un dossier par serveur Discord dans data/guilds/).
//
// Utilisation :
//   node scripts/migrate-data-v2.js --dry-run                    (n'écrit rien)
//   node scripts/migrate-data-v2.js --guild-id <ID> --dry-run
//   node scripts/migrate-data-v2.js --guild-id <ID>              (migration réelle)
//
// Garanties :
//   - --dry-run ne touche RIEN sur le disque
//   - une sauvegarde complète est faite avant toute écriture ; si elle échoue,
//     la migration est annulée
//   - les anciens fichiers ne sont JAMAIS supprimés
//   - la migration est idempotente : relancée, elle refuse proprement
//   - les compteurs sont revalidés après écriture
'use strict';

const fs = require('fs');
const path = require('path');

const guildStore = require('../services/guildStore');
const { readJsonAt } = require('../services/dataStore');

const DATA_DIR = guildStore.DATA_DIR;
const PROJECT_ROOT = path.join(__dirname, '..');
// Les sauvegardes vivent DANS le dossier data/, et non à côté.
//
// En conteneur, seul /app/data est monté : une sauvegarde placée dans
// /app/data-backups partait avec le conteneur au premier recreate, c'est-à-dire
// exactement au moment où on en aurait eu besoin. À l'intérieur du volume,
// elle est persistée que la migration soit lancée sur l'hôte ou via
// `docker exec`.
const BACKUP_ROOT = path.join(DATA_DIR, 'backups');
const FILES = guildStore.FILES;
const GLOBAL_FILES = guildStore.GLOBAL_FILES;

const GUILD_ID_RE = /^\d{17,20}$/;

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

const log = (...args) => console.log(...args);
const fail = (...args) => console.error(...args);

function title(text) {
  log(`\n${'='.repeat(64)}\n${text}\n${'='.repeat(64)}`);
}

/** Chemin lisible : relatif au projet quand c'est pertinent, absolu sinon. */
function displayPath(absolute) {
  const relative = path.relative(PROJECT_ROOT, absolute);
  return relative.startsWith('..') ? absolute : relative;
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { dryRun: false, guildId: null, force: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--guild-id') options.guildId = argv[++i] || null;
    else if (arg.startsWith('--guild-id=')) options.guildId = arg.slice('--guild-id='.length);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      fail(`❌ Option inconnue : ${arg}`);
      process.exit(2);
    }
  }

  if (options.guildId && !GUILD_ID_RE.test(options.guildId)) {
    fail(`❌ --guild-id invalide : "${options.guildId}" (un ID Discord fait 17 à 20 chiffres).`);
    process.exit(2);
  }

  return options;
}

function printHelp() {
  log(`
Migration des données du bot : v1 (data/*.json) → v2 (data/guilds/<guildId>/).

  node scripts/migrate-data-v2.js --dry-run
      Analyse les anciennes données et affiche ce qui serait fait. N'écrit rien.

  node scripts/migrate-data-v2.js --guild-id 123456789012345678 --dry-run
      Idem, en précisant à quel serveur rattacher les données sans guildId.

  node scripts/migrate-data-v2.js --guild-id 123456789012345678
      Migration réelle (sauvegarde automatique préalable).

Options :
  --dry-run              N'écrit rien, affiche seulement le plan.
  --guild-id <ID>        Serveur auquel rattacher les données héritées sans guildId.
  --force                Autorise l'écriture même si data/guilds/ contient déjà des données.
  --help                 Affiche cette aide.
`);
}

// ---------------------------------------------------------------------------
// Lecture des anciennes données
// ---------------------------------------------------------------------------

function readLegacy(relativePath) {
  const absolute = path.join(DATA_DIR, relativePath);
  if (!fs.existsSync(absolute)) return { exists: false, data: null, path: absolute };
  return { exists: true, data: readJsonAt(absolute, null), path: absolute };
}

function readLegacyRoot(fileName) {
  const absolute = path.join(PROJECT_ROOT, fileName);
  if (!fs.existsSync(absolute)) return { exists: false, data: null, path: absolute };
  return { exists: true, data: readJsonAt(absolute, null), path: absolute };
}

function loadLegacy() {
  const sources = {
    devoirs: readLegacy('devoirs.json'),
    archives: readLegacy('devoirs-archives.json'),
    devoirsConfig: readLegacy('devoirs-config.json'),
    reminders: readLegacy('reminders.json'),
    guildConfig: readLegacy('guild-config.json'),
    stats: readLegacy('stats.json'),
    rssConfig: readLegacy('rss-config.json'),
    rssState: readLegacy('rss-state.json'),
    eventsConfig: readLegacy('events-config.json'),
  };

  // Emplacements pré-data/ (racine du dépôt), encore possibles sur d'anciennes installations.
  const rootFallbacks = {
    stats: readLegacyRoot('stats.json'),
    rssConfig: readLegacyRoot('rss-config.json'),
    eventsConfig: readLegacyRoot('events-config.json'),
  };

  for (const [key, fallback] of Object.entries(rootFallbacks)) {
    const isEmpty = !sources[key].exists || sources[key].data === null
      || (typeof sources[key].data === 'object' && Object.keys(sources[key].data).length === 0);
    if (isEmpty && fallback.exists && fallback.data) {
      sources[key] = { ...fallback, fromRoot: true };
    }
  }

  return sources;
}

const asArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

// ---------------------------------------------------------------------------
// Détection des serveurs
// ---------------------------------------------------------------------------

/** Extrait le guildId du préfixe d'un feedId RSS (`<guildId>_<channelId>_<ts>`). */
function guildIdFromFeedId(feedId) {
  const prefix = String(feedId).split('_')[0];
  return GUILD_ID_RE.test(prefix) ? prefix : null;
}

function detectGuilds(legacy) {
  const guildIds = new Set();
  const orphans = { devoirs: 0, archives: 0, reminders: 0, rssState: 0, stats: 0 };

  for (const devoir of asArray(legacy.devoirs.data)) {
    if (GUILD_ID_RE.test(String(devoir.guildId))) guildIds.add(String(devoir.guildId));
    else orphans.devoirs++;
  }

  for (const archive of asArray(legacy.archives.data)) {
    if (GUILD_ID_RE.test(String(archive.guildId))) guildIds.add(String(archive.guildId));
    else orphans.archives++;
  }

  for (const reminder of asArray(asObject(legacy.reminders.data).reminders)) {
    if (GUILD_ID_RE.test(String(reminder.guildId))) guildIds.add(String(reminder.guildId));
    else orphans.reminders++;
  }

  for (const key of Object.keys(asObject(legacy.devoirsConfig.data))) {
    if (GUILD_ID_RE.test(key)) guildIds.add(key);
  }
  for (const key of Object.keys(asObject(asObject(legacy.guildConfig.data).guilds))) {
    if (GUILD_ID_RE.test(key)) guildIds.add(key);
  }
  for (const key of Object.keys(asObject(legacy.rssConfig.data))) {
    if (GUILD_ID_RE.test(key)) guildIds.add(key);
  }
  for (const key of Object.keys(asObject(asObject(legacy.eventsConfig.data).events))) {
    if (GUILD_ID_RE.test(key)) guildIds.add(key);
  }

  for (const feedId of Object.keys(asObject(asObject(legacy.rssState.data).feeds))) {
    const guildId = guildIdFromFeedId(feedId);
    if (guildId) guildIds.add(guildId);
    else orphans.rssState++;
  }

  // stats.json était strictement global : aucun de ses compteurs ne porte de guild.
  orphans.stats = Object.keys(asObject(legacy.stats.data)).length;

  return { guildIds, orphans };
}

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

const DEFAULT_CATEGORY_DEFS = [
  { name: 'Devoir', emoji: '📚', legacySlug: 'devoir' },
  { name: 'Examen', emoji: '📝', legacySlug: 'examen' },
  { name: 'Projet', emoji: '🚧', legacySlug: 'projet' },
];

function makeCategoryId(taken) {
  let id;
  do {
    id = `cat_${Math.random().toString(16).slice(2, 8).padEnd(6, '0')}`;
  } while (taken.has(id));
  taken.add(id);
  return id;
}

function humanizeSlug(slug) {
  const clean = String(slug).trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Construit les catégories d'un serveur : les 3 catégories historiques, plus
 * toute autre valeur de `type` réellement présente dans ses données.
 * Retourne aussi la table de correspondance ancien `type` → nouvel ID stable.
 */
function buildCategoriesFor(devoirs, archives, createdAt) {
  const taken = new Set();
  const categories = DEFAULT_CATEGORY_DEFS.map((def, index) => ({
    id: makeCategoryId(taken),
    name: def.name,
    emoji: def.emoji,
    enabled: true,
    order: index,
    legacySlug: def.legacySlug,
    createdAt,
  }));

  const bySlug = new Map(categories.map(c => [c.legacySlug, c]));

  // Types inattendus rencontrés dans les données : on les conserve comme
  // catégories à part entière plutôt que de les écraser.
  for (const item of [...devoirs, ...archives]) {
    const slug = String(item?.type || 'devoir').trim().toLowerCase();
    if (!slug || bySlug.has(slug)) continue;

    const extra = {
      id: makeCategoryId(taken),
      name: humanizeSlug(slug),
      emoji: null,
      enabled: true,
      order: categories.length,
      legacySlug: slug,
      createdAt,
    };
    categories.push(extra);
    bySlug.set(slug, extra);
  }

  return { categories, bySlug };
}

// ---------------------------------------------------------------------------
// Construction du plan
// ---------------------------------------------------------------------------

/** Ajoute matiere/heure/categoryId à un devoir hérité, sans toucher à son ID. */
function upgradeDevoir(item, guildId, bySlug, anomalies, label) {
  const slug = String(item.type || 'devoir').trim().toLowerCase();
  const category = bySlug.get(slug) || bySlug.get('devoir');

  if (!bySlug.has(slug)) {
    anomalies.push(`${label} « ${item.titre || 'sans titre'} » : type "${item.type}" inconnu, rattaché à « Devoir ».`);
  }

  // Les anciens IDs sont des Date.now() : ils font d'excellents createdAt.
  const numericId = Number(item.id);
  const createdAt = Number.isFinite(numericId) && numericId > 1e12
    ? new Date(numericId).toISOString()
    : null;

  return {
    id: item.id,
    guildId,
    channelId: item.channelId || null,
    matiere: '', // n'existait pas en v1 : à compléter depuis le panel
    titre: item.titre || '',
    date: item.date || '',
    heure: null, // n'existait pas en v1
    description: item.description || '',
    categoryId: category.id,
    type: category.legacySlug, // miroir legacy conservé (retour arrière possible)
    importance: item.importance || 'important',
    customTimings: Array.isArray(item.customTimings) ? item.customTimings : [],
    createdAt,
    updatedAt: null,
    ...(item.archivedAt ? { archivedAt: item.archivedAt } : {}),
  };
}

function defaultConfigFor(devoirsCfg, guildCfg) {
  const feur = asObject(guildCfg.feur);
  const rules = Array.isArray(feur.rules) && feur.rules.length > 0
    ? feur.rules
    : [{ id: 'default-quoi', trigger: 'quoi', response: 'Feur.' }];

  return {
    version: 2,
    features: {
      feur: true, homework: true, stats: true, rss: true, recurringEvents: true,
      ...asObject(guildCfg.features),
    },
    feur: {
      cooldownMinutes: Number.isFinite(Number(feur.cooldownMinutes)) ? Number(feur.cooldownMinutes) : 30,
      rules,
    },
    devoirs: {
      roleId: devoirsCfg.roleId || null,
      reminderChannelId: devoirsCfg.reminderChannelId || null,
      boardChannelId: devoirsCfg.boardChannelId || null,
      // Le rendu du tableau change complètement : on repart d'un message neuf.
      boardMessageId: null,
      boardExtraMessageIds: [],
      boardLastUpdate: null,
      customTimings: Array.isArray(devoirsCfg.customTimings) ? devoirsCfg.customTimings : [],
    },
  };
}

function buildPlan(legacy, guildIds, fallbackGuildId) {
  const anomalies = [];
  const now = new Date().toISOString();
  const plan = new Map();

  const targetGuild = (rawGuildId) => {
    const id = String(rawGuildId);
    return GUILD_ID_RE.test(id) ? id : fallbackGuildId;
  };

  const ensure = (guildId) => {
    if (!plan.has(guildId)) {
      plan.set(guildId, {
        guildId,
        devoirs: [], archives: [], reminders: [], stats: {},
        rssFeeds: {}, rssState: {}, events: {},
        devoirsCfgRaw: {}, guildCfgRaw: {},
        categories: [], bySlug: null,
      });
    }
    return plan.get(guildId);
  };

  for (const guildId of guildIds) ensure(guildId);
  if (fallbackGuildId) ensure(fallbackGuildId);

  // --- Regroupement brut par serveur --------------------------------------
  for (const item of asArray(legacy.devoirs.data)) {
    const guildId = targetGuild(item.guildId);
    if (guildId) ensure(guildId).devoirs.push(item);
  }
  for (const item of asArray(legacy.archives.data)) {
    const guildId = targetGuild(item.guildId);
    if (guildId) ensure(guildId).archives.push(item);
  }
  for (const item of asArray(asObject(legacy.reminders.data).reminders)) {
    const guildId = targetGuild(item.guildId);
    if (guildId) ensure(guildId).reminders.push(item);
  }
  for (const [guildId, cfg] of Object.entries(asObject(legacy.devoirsConfig.data))) {
    if (GUILD_ID_RE.test(guildId)) ensure(guildId).devoirsCfgRaw = asObject(cfg);
  }
  for (const [guildId, cfg] of Object.entries(asObject(asObject(legacy.guildConfig.data).guilds))) {
    if (GUILD_ID_RE.test(guildId)) ensure(guildId).guildCfgRaw = asObject(cfg);
  }
  for (const [guildId, feeds] of Object.entries(asObject(legacy.rssConfig.data))) {
    if (GUILD_ID_RE.test(guildId)) ensure(guildId).rssFeeds = asObject(feeds);
  }
  for (const [guildId, events] of Object.entries(asObject(asObject(legacy.eventsConfig.data).events))) {
    if (GUILD_ID_RE.test(guildId)) ensure(guildId).events = asObject(events);
  }
  for (const [feedId, state] of Object.entries(asObject(asObject(legacy.rssState.data).feeds))) {
    const guildId = guildIdFromFeedId(feedId) || fallbackGuildId;
    if (guildId) ensure(guildId).rssState[feedId] = state;
    else anomalies.push(`État RSS du flux "${feedId}" : serveur indéterminable, ignoré.`);
  }

  // stats.json était global : tout est rattaché au serveur indiqué par --guild-id.
  const legacyStats = asObject(legacy.stats.data);
  if (Object.keys(legacyStats).length > 0 && fallbackGuildId) {
    ensure(fallbackGuildId).stats = { ...legacyStats };
  }

  // --- Transformations ----------------------------------------------------
  for (const entry of plan.values()) {
    const { categories, bySlug } = buildCategoriesFor(entry.devoirs, entry.archives, now);
    entry.categories = categories;
    entry.bySlug = bySlug;

    entry.newDevoirs = entry.devoirs.map(d => upgradeDevoir(d, entry.guildId, bySlug, anomalies, 'Devoir'));
    entry.newArchives = entry.archives.map(d => upgradeDevoir(d, entry.guildId, bySlug, anomalies, 'Archive'));

    // Table devoirId -> categoryId pour enrichir les rappels.
    const categoryByDevoirId = new Map(
      [...entry.newDevoirs, ...entry.newArchives].map(d => [String(d.id), d.categoryId]),
    );

    entry.newReminders = entry.reminders.map(reminder => {
      const slug = String(reminder.type || 'devoir').trim().toLowerCase();
      const categoryId =
        categoryByDevoirId.get(String(reminder.devoirId)) ||
        (bySlug.get(slug) || bySlug.get('devoir')).id;

      if (reminder.devoirId !== undefined && !categoryByDevoirId.has(String(reminder.devoirId))) {
        anomalies.push(
          `Rappel ${reminder.id} : devoir ${reminder.devoirId} introuvable ` +
          `(rappel orphelin conservé, statut "${reminder.status}").`,
        );
      }

      return {
        ...reminder,
        guildId: entry.guildId,
        matiere: reminder.matiere || '',
        heure: reminder.heure || null,
        categoryId,
      };
    });

    entry.config = defaultConfigFor(entry.devoirsCfgRaw, entry.guildCfgRaw);
  }

  const globalSettings = asObject(asObject(legacy.eventsConfig.data).settings);
  const globalReminders = asObject(asObject(legacy.eventsConfig.data).reminders);

  return { plan, anomalies, globalSettings, globalReminders };
}

// ---------------------------------------------------------------------------
// Affichage du plan
// ---------------------------------------------------------------------------

function printPlan({ plan, anomalies }, legacy, options) {
  title(`Migration Data v1 → v2${options.dryRun ? '  [DRY RUN]' : ''}`);

  log('\nSources détectées :');
  for (const [key, source] of Object.entries(legacy)) {
    if (!source.exists) continue;
    log(`  • ${displayPath(source.path)}${source.fromRoot ? '  (ancien emplacement racine)' : ''}`);
  }

  for (const entry of plan.values()) {
    log(`\n${'-'.repeat(64)}`);
    log(`Serveur :\n${entry.guildId}\n`);
    log(`  ${entry.newDevoirs.length} devoir(s)`);
    log(`  ${entry.newArchives.length} archive(s)`);
    log(`  ${entry.newReminders.length} rappel(s)`);
    log(`  ${entry.categories.length} catégorie(s)`);
    log(`  ${Object.keys(entry.stats).length} utilisateur(s) dans les statistiques`);
    log(`  ${Object.keys(entry.rssFeeds).length} flux RSS`);
    log(`  ${Object.keys(entry.events).length} événement(s) récurrent(s)`);

    log('\n  Catégories créées :');
    for (const cat of entry.categories) {
      const used = [...entry.newDevoirs, ...entry.newArchives].filter(d => d.categoryId === cat.id).length;
      log(`    ${cat.id}  ${cat.emoji || ' '} ${cat.name.padEnd(12)} (ancien type "${cat.legacySlug}") — ${used} devoir(s)`);
    }

    log('\n  Création prévue :');
    log(`    data/guilds/${entry.guildId}/`);
    const files = [
      FILES.CONFIG, FILES.CATEGORIES, FILES.DEVOIRS, FILES.ARCHIVES,
      FILES.REMINDERS, FILES.STATS, FILES.RSS_CONFIG, FILES.RSS_STATE, FILES.EVENTS,
    ];
    files.forEach((file, i) => log(`    ${i === files.length - 1 ? '└──' : '├──'} ${file}`));
  }

  if (anomalies.length > 0) {
    log(`\n${'-'.repeat(64)}`);
    log(`⚠️  ${anomalies.length} anomalie(s) détectée(s) :`);
    for (const anomaly of anomalies.slice(0, 30)) log(`   - ${anomaly}`);
    if (anomalies.length > 30) log(`   ... et ${anomalies.length - 30} autre(s).`);
  }
}

// ---------------------------------------------------------------------------
// Sauvegarde
// ---------------------------------------------------------------------------

function uniqueBackupDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', 'T').slice(0, 15);
  let target = path.join(BACKUP_ROOT, `migration-${stamp}`);
  let counter = 1;
  // Ne jamais écraser une sauvegarde existante.
  while (fs.existsSync(target)) target = path.join(BACKUP_ROOT, `migration-${stamp}-${counter++}`);
  return target;
}

function createBackup() {
  const target = uniqueBackupDir();
  fs.mkdirSync(target, { recursive: true });

  // Copie entrée par entrée plutôt que d'un bloc : les sauvegardes vivant
  // désormais DANS data/, fs.cpSync refuserait de copier un dossier vers son
  // propre sous-dossier (EINVAL), filtre ou pas.
  if (fs.existsSync(DATA_DIR)) {
    const dataTarget = path.join(target, 'data');
    fs.mkdirSync(dataTarget, { recursive: true });

    for (const entry of fs.readdirSync(DATA_DIR)) {
      const source = path.join(DATA_DIR, entry);
      if (source === BACKUP_ROOT) continue; // on ne sauvegarde pas les sauvegardes
      fs.cpSync(source, path.join(dataTarget, entry), { recursive: true });
    }
  }

  // Fichiers legacy encore présents à la racine du dépôt.
  for (const fileName of ['stats.json', 'rss-config.json', 'events-config.json']) {
    const source = path.join(PROJECT_ROOT, fileName);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, `root-${fileName}`));
  }

  // Vérifie que la sauvegarde contient réellement quelque chose avant d'aller
  // plus loin : une sauvegarde vide ne protège de rien.
  const copied = fs.existsSync(path.join(target, 'data'))
    ? fs.readdirSync(path.join(target, 'data'))
    : [];
  if (copied.length === 0) throw new Error('la sauvegarde est vide');

  return target;
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

function writePlan({ plan, globalSettings, globalReminders }) {
  for (const entry of plan.values()) {
    const g = entry.guildId;

    guildStore.ensureGuildDir(g);
    guildStore.writeGuildJson(g, FILES.CONFIG, entry.config);
    guildStore.writeGuildJson(g, FILES.CATEGORIES, { version: 2, categories: entry.categories });
    guildStore.writeGuildJson(g, FILES.DEVOIRS, entry.newDevoirs);
    guildStore.writeGuildJson(g, FILES.ARCHIVES, entry.newArchives);
    guildStore.writeGuildJson(g, FILES.REMINDERS, { version: 2, reminders: entry.newReminders });
    guildStore.writeGuildJson(g, FILES.STATS, entry.stats);
    guildStore.writeGuildJson(g, FILES.RSS_CONFIG, { version: 2, feeds: entry.rssFeeds });
    guildStore.writeGuildJson(g, FILES.RSS_STATE, { version: 2, feeds: entry.rssState });
    guildStore.writeGuildJson(g, FILES.EVENTS, { version: 2, events: entry.events });
  }

  guildStore.writeGlobalJson(GLOBAL_FILES.EVENTS_SETTINGS, {
    version: 2,
    settings: globalSettings,
    reminders: globalReminders,
  });
}

// ---------------------------------------------------------------------------
// Validation post-migration
// ---------------------------------------------------------------------------

function validate({ plan }) {
  const errors = [];

  for (const entry of plan.values()) {
    const g = entry.guildId;
    const read = (file, fallback) => guildStore.readGuildJson(g, file, fallback);

    const devoirs = read(FILES.DEVOIRS, []);
    const archives = read(FILES.ARCHIVES, []);
    const reminders = read(FILES.REMINDERS, { reminders: [] }).reminders || [];
    const categories = read(FILES.CATEGORIES, { categories: [] }).categories || [];
    const stats = read(FILES.STATS, {});

    const check = (label, actual, expected) => {
      if (actual !== expected) errors.push(`[${g}] ${label} : ${actual} relu(s) au lieu de ${expected}.`);
    };

    check('devoirs', devoirs.length, entry.newDevoirs.length);
    check('archives', archives.length, entry.newArchives.length);
    check('rappels', reminders.length, entry.newReminders.length);
    check('catégories', categories.length, entry.categories.length);
    check('statistiques', Object.keys(stats).length, Object.keys(entry.stats).length);

    const categoryIds = new Set(categories.map(c => c.id));

    // Relation catégorie <-> devoir : aucune référence orpheline.
    for (const item of [...devoirs, ...archives]) {
      if (!categoryIds.has(item.categoryId)) {
        errors.push(`[${g}] Devoir ${item.id} référence une catégorie inconnue (${item.categoryId}).`);
      }
      if (String(item.guildId) !== g) {
        errors.push(`[${g}] Devoir ${item.id} porte le guildId ${item.guildId}.`);
      }
    }

    // Relation rappel <-> serveur.
    for (const reminder of reminders) {
      if (String(reminder.guildId) !== g) {
        errors.push(`[${g}] Rappel ${reminder.id} porte le guildId ${reminder.guildId}.`);
      }
    }

    // Aucun ID de devoir perdu ni dupliqué.
    const expectedIds = new Set(entry.newDevoirs.map(d => String(d.id)));
    const actualIds = new Set(devoirs.map(d => String(d.id)));
    for (const id of expectedIds) {
      if (!actualIds.has(id)) errors.push(`[${g}] Devoir ${id} absent après migration.`);
    }
    if (actualIds.size !== devoirs.length) {
      errors.push(`[${g}] IDs de devoirs dupliqués après migration.`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Programme principal
// ---------------------------------------------------------------------------

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();

  // --- Idempotence ---------------------------------------------------------
  const currentVersion = guildStore.getSchemaVersion();
  if (currentVersion >= guildStore.SCHEMA_VERSION) {
    // Cas normal : la migration a déjà été faite, ou il n'y a rien à migrer.
    if (guildStore.hasBeenMigrated() || !guildStore.hasLegacyData()) {
      title('Migration Data v1 → v2');
      log(`\n✅ Les données sont déjà au schéma v${currentVersion}. Aucune migration nécessaire.`);
      log('   (Le fichier data/schema.json fait foi. Rien n\'a été modifié.)\n');
      return;
    }

    // Cas anormal : le schéma annonce v2 mais il reste des données à plat.
    // Cela arrivait quand le bot était démarré avant la migration : il
    // tamponnait le schéma sans rien déplacer. On ne refuse plus en silence.
    if (!options.force) {
      title('Migration Data v1 → v2  —  INCOHÉRENCE DÉTECTÉE');
      log(`\ndata/schema.json annonce la v${currentVersion}, mais des données sont`);
      log('encore présentes dans les anciens fichiers à plat :\n');
      for (const fileName of guildStore.LEGACY_FILES) {
        const filePath = path.join(DATA_DIR, fileName);
        if (fs.existsSync(filePath)) log(`  • data/${fileName}`);
      }
      log('\nCela se produit quand le bot a été démarré avant la migration :');
      log('il a marqué le schéma comme à jour sans rien déplacer.');
      log('\nVérifie le plan, puis relance avec --force pour migrer quand même :');
      log(`  node scripts/migrate-data-v2.js${options.guildId ? ` --guild-id ${options.guildId}` : ''} --dry-run`);
      log(`  node scripts/migrate-data-v2.js${options.guildId ? ` --guild-id ${options.guildId}` : ''} --force\n`);
      process.exitCode = 1;
      return;
    }

    log(`\n⚠️  Schéma déjà en v${currentVersion} mais données héritées présentes : migration forcée.\n`);
  }

  const legacy = loadLegacy();
  const { guildIds, orphans } = detectGuilds(legacy);
  const orphanTotal = Object.values(orphans).reduce((a, b) => a + b, 0);

  // --- Aucune donnée à migrer ---------------------------------------------
  const hasAnyLegacy = Object.values(legacy).some(s => s.exists && s.data !== null);
  if (!hasAnyLegacy && guildIds.size === 0) {
    title('Migration Data v1 → v2');
    log('\nAucune donnée héritée trouvée : installation vierge.');
    if (options.dryRun) {
      log('DRY RUN terminé. Aucune donnée modifiée.\n');
      return;
    }
    guildStore.writeSchemaVersion(guildStore.SCHEMA_VERSION);
    log(`✅ data/schema.json initialisé en v${guildStore.SCHEMA_VERSION}.\n`);
    return;
  }

  // --- guildId requis pour les données héritées sans serveur ---------------
  if (orphanTotal > 0 && !options.guildId) {
    title('Migration Data v1 → v2  —  ACTION REQUISE');
    log('\nCertaines données héritées ne contiennent aucun guildId :');
    if (orphans.devoirs) log(`  • ${orphans.devoirs} devoir(s)`);
    if (orphans.archives) log(`  • ${orphans.archives} archive(s)`);
    if (orphans.reminders) log(`  • ${orphans.reminders} rappel(s)`);
    if (orphans.rssState) log(`  • ${orphans.rssState} état(s) de flux RSS`);
    if (orphans.stats) log(`  • ${orphans.stats} utilisateur(s) dans stats.json (fichier global en v1)`);

    log('\nJe ne devine pas à quel serveur elles appartiennent.');
    if (guildIds.size > 0) {
      log(`\nServeur(s) détecté(s) dans le reste des données :`);
      for (const guildId of guildIds) log(`  ${guildId}`);
      log(`\nRelance avec, par exemple :`);
      log(`  node scripts/migrate-data-v2.js --guild-id ${[...guildIds][0]} --dry-run`);
    } else {
      log('\nAucun serveur n\'a pu être détecté. Indique explicitement l\'ID :');
      log('  node scripts/migrate-data-v2.js --guild-id <DISCORD_GUILD_ID> --dry-run');
    }
    log('');
    process.exitCode = 1;
    return;
  }

  const built = buildPlan(legacy, guildIds, options.guildId);
  printPlan(built, legacy, options);

  // Aucun serveur détecté : il n'y a rien à éclater, mais le stockage est bien
  // au format v2 (dossiers créés à la volée). On marque le schéma pour ne pas
  // laisser le bot avertir indéfiniment ni relancer la migration à chaque fois.
  if (built.plan.size === 0) {
    log('\nAucun serveur à migrer (aucune donnée rattachée à une guild).');
    if (options.dryRun) {
      log('DRY RUN terminé. Aucune donnée modifiée.\n');
      return;
    }
    guildStore.writeSchemaVersion(guildStore.SCHEMA_VERSION);
    log(`✅ data/schema.json → v${guildStore.SCHEMA_VERSION}. Les anciens fichiers sont conservés.\n`);
    return;
  }

  // --- Dry run -------------------------------------------------------------
  if (options.dryRun) {
    log(`\n${'='.repeat(64)}`);
    log('DRY RUN terminé.');
    log('Aucune donnée modifiée.');
    log(`${'='.repeat(64)}\n`);
    return;
  }

  // --- Destination déjà peuplée -------------------------------------------
  const existing = guildStore.listGuildIds();
  if (existing.length > 0 && !options.force) {
    fail(`\n❌ data/guilds/ contient déjà des données (${existing.join(', ')}).`);
    fail('   La migration s\'arrête pour ne rien écraser.');
    fail('   Vérifie ces dossiers, puis relance avec --force si tu veux vraiment les remplacer.\n');
    process.exitCode = 1;
    return;
  }

  // --- Sauvegarde ----------------------------------------------------------
  let backupDir;
  try {
    backupDir = createBackup();
    log(`\n💾 Sauvegarde créée : ${displayPath(backupDir)}`);
  } catch (error) {
    fail(`\n❌ Sauvegarde impossible (${error.message}). Migration annulée, rien n'a été modifié.\n`);
    process.exitCode = 1;
    return;
  }

  // --- Écriture ------------------------------------------------------------
  log('\n📝 Écriture des nouvelles données...');
  try {
    writePlan(built);
  } catch (error) {
    fail(`\n❌ Erreur pendant l'écriture : ${error.message}`);
    fail(`   La sauvegarde est intacte : ${displayPath(backupDir)}\n`);
    process.exitCode = 1;
    return;
  }

  // --- Validation ----------------------------------------------------------
  log('🔎 Validation des données écrites...');
  const errors = validate(built);

  if (errors.length > 0) {
    fail(`\n❌ La migration a échoué : ${errors.length} incohérence(s) détectée(s).`);
    for (const error of errors.slice(0, 20)) fail(`   - ${error}`);
    if (errors.length > 20) fail(`   ... et ${errors.length - 20} autre(s).`);
    fail(`\n   data/schema.json n'a PAS été passé en v2.`);
    fail(`   Sauvegarde conservée : ${displayPath(backupDir)}\n`);
    process.exitCode = 1;
    return;
  }

  guildStore.writeSchemaVersion(guildStore.SCHEMA_VERSION, {
    migratedAt: new Date().toISOString(),
  });

  title('Migration terminée avec succès');
  log(`\n✅ ${built.plan.size} serveur(s) migré(s) vers data/guilds/.`);
  log(`✅ Validation OK (devoirs, archives, rappels, catégories, statistiques).`);
  log(`✅ data/schema.json → v${guildStore.SCHEMA_VERSION}`);
  log(`\n📦 Sauvegarde : ${displayPath(backupDir)}`);
  log('ℹ️  Les anciens fichiers data/*.json sont CONSERVÉS tels quels.');
  log('   Supprime-les manuellement une fois le bot validé en production.\n');
}

if (require.main === module) main();

module.exports = { parseArgs, detectGuilds, buildPlan, buildCategoriesFor, upgradeDevoir, validate };
