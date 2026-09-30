// services/guildStore.js
// Couche centrale de stockage multi-serveur.
//
// Organisation physique du dossier data/ (schéma v2) :
//
//   data/
//   ├── schema.json                    { "version": 2 }
//   ├── guilds/
//   │   └── <guildId>/                 (guildId = snowflake Discord, 17-20 chiffres)
//   │       ├── config.json            config devoirs + features + feur
//   │       ├── devoirs.json
//   │       ├── devoirs-archives.json
//   │       ├── reminders.json
//   │       ├── categories.json
//   │       ├── stats.json
//   │       ├── rss-config.json
//   │       ├── rss-state.json
//   │       └── events.json
//   └── global/                        données réellement globales au bot
//       ├── events-settings.json       réglages partagés du système d'événements
//       └── reminders-orphans.json     rappels sans guild rattachable
//
// AUCUN autre module ne doit construire de chemin `data/guilds/<id>/...`
// à la main : tout passe par readGuildJson / writeGuildJson.
const fs = require('fs');
const path = require('path');

const { createLogger } = require('../utils/logger');
const {
  DATA_DIR,
  ensureDir,
  readJsonAt,
  writeJsonAt,
  structuredCloneSafe,
} = require('./dataStore');

const log = createLogger('guildStore');

const GUILDS_DIR = path.join(DATA_DIR, 'guilds');
const GLOBAL_DIR = path.join(DATA_DIR, 'global');
const SCHEMA_PATH = path.join(DATA_DIR, 'schema.json');

const SCHEMA_VERSION = 2;

/** Noms de fichiers par serveur. Source unique de vérité. */
const FILES = {
  CONFIG: 'config.json',
  DEVOIRS: 'devoirs.json',
  ARCHIVES: 'devoirs-archives.json',
  REMINDERS: 'reminders.json',
  CATEGORIES: 'categories.json',
  STATS: 'stats.json',
  RSS_CONFIG: 'rss-config.json',
  RSS_STATE: 'rss-state.json',
  EVENTS: 'events.json',
};

/** Noms de fichiers réellement globaux au bot. */
const GLOBAL_FILES = {
  EVENTS_SETTINGS: 'events-settings.json',
  ORPHAN_REMINDERS: 'reminders-orphans.json',
};

// Un ID Discord (snowflake) est un entier décimal de 17 à 20 chiffres.
// Cette validation est la seule barrière entre une valeur venant d'une
// interaction utilisateur et le système de fichiers : elle interdit
// mécaniquement "..", "/", "~" et tout chemin arbitraire.
const GUILD_ID_RE = /^\d{17,20}$/;

function isValidGuildId(guildId) {
  return typeof guildId === 'string' && GUILD_ID_RE.test(guildId);
}

/**
 * Normalise puis valide un guildId. Retourne null (avec un log) si invalide,
 * pour que les appelants dégradent proprement au lieu de faire planter le bot.
 */
function normalizeGuildId(guildId) {
  const id = guildId === null || guildId === undefined ? '' : String(guildId);
  if (!isValidGuildId(id)) return null;
  return id;
}

/** Chemin absolu du dossier d'un serveur. Retourne null si guildId invalide. */
function getGuildDataPath(guildId, fileName) {
  const id = normalizeGuildId(guildId);
  if (!id) return null;
  const dir = path.join(GUILDS_DIR, id);
  return fileName ? path.join(dir, fileName) : dir;
}

/** Crée le dossier du serveur s'il n'existe pas. Retourne le chemin ou null. */
function ensureGuildDir(guildId) {
  const dir = getGuildDataPath(guildId);
  if (!dir) return null;
  ensureDir(dir);
  return dir;
}

/**
 * Lit un fichier JSON d'un serveur. Si le fichier n'existe pas, retourne les
 * valeurs par défaut fournies (sans écrire sur le disque : la création
 * effective n'a lieu qu'au premier write, pour ne pas semer des fichiers
 * vides à chaque lecture).
 */
function readGuildJson(guildId, fileName, fallback) {
  const filePath = getGuildDataPath(guildId, fileName);
  if (!filePath) {
    log.error(`Lecture refusée : guildId invalide (${guildId}) pour ${fileName}.`);
    return structuredCloneSafe(fallback);
  }
  return readJsonAt(filePath, fallback);
}

/** Écrit un fichier JSON d'un serveur (atomique). Retourne true/false. */
function writeGuildJson(guildId, fileName, data) {
  const filePath = getGuildDataPath(guildId, fileName);
  if (!filePath) {
    log.error(`Écriture refusée : guildId invalide (${guildId}) pour ${fileName}.`);
    return false;
  }
  return writeJsonAt(filePath, data);
}

/** Existence d'un fichier de serveur. */
function guildFileExists(guildId, fileName) {
  const filePath = getGuildDataPath(guildId, fileName);
  return Boolean(filePath) && fs.existsSync(filePath);
}

/** Le serveur a-t-il déjà un dossier de données ? */
function guildExists(guildId) {
  const dir = getGuildDataPath(guildId);
  return Boolean(dir) && fs.existsSync(dir);
}

/**
 * Liste les IDs de tous les serveurs ayant des données sur le disque.
 * Filtre tout nom de dossier qui n'est pas un snowflake valide.
 */
function listGuildIds() {
  if (!fs.existsSync(GUILDS_DIR)) return [];
  try {
    return fs
      .readdirSync(GUILDS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && isValidGuildId(entry.name))
      .map(entry => entry.name);
  } catch (e) {
    log.error('Impossible de lister les serveurs:', e.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Données globales
// ---------------------------------------------------------------------------

function readGlobalJson(fileName, fallback) {
  return readJsonAt(path.join(GLOBAL_DIR, fileName), fallback);
}

function writeGlobalJson(fileName, data) {
  return writeJsonAt(path.join(GLOBAL_DIR, fileName), data);
}

// ---------------------------------------------------------------------------
// Version du schéma
// ---------------------------------------------------------------------------

// Fichiers du schéma v1, restés à la racine de data/. Leur simple présence
// avec du contenu signifie qu'une migration est encore à faire.
const LEGACY_FILES = [
  'devoirs.json',
  'devoirs-archives.json',
  'devoirs-config.json',
  'reminders.json',
  'guild-config.json',
  'stats.json',
  'rss-config.json',
  'rss-state.json',
  'events-config.json',
];

/**
 * Y a-t-il des données au format v1 à la racine de data/ ?
 * Un fichier vide (`[]`, `{}`) ne compte pas : il ne reste rien à migrer.
 */
function hasLegacyData() {
  for (const fileName of LEGACY_FILES) {
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) continue;

    const content = readJsonAt(filePath, null);
    if (Array.isArray(content) && content.length > 0) return true;
    if (content && !Array.isArray(content) && typeof content === 'object'
        && Object.keys(content).length > 0) return true;
  }
  return false;
}

function readSchema() {
  const data = readJsonAt(SCHEMA_PATH, { version: 1 });
  const version = Number(data?.version);
  return {
    version: Number.isFinite(version) ? version : 1,
    // Renseigné uniquement par scripts/migrate-data-v2.js. Distingue « le
    // schéma est à jour parce que la migration a tourné » de « le bot a
    // tamponné le schéma sur une installation vierge ».
    migratedAt: typeof data?.migratedAt === 'string' ? data.migratedAt : null,
  };
}

/**
 * La migration a-t-elle réellement eu lieu ?
 * `migratedAt` est le signal explicite. Pour les installations migrées avant
 * l'introduction de ce champ, la présence de fichiers de devoirs ou de rappels
 * dans un dossier de serveur fait foi.
 */
function hasBeenMigrated() {
  if (readSchema().migratedAt) return true;
  return listGuildIds().some(
    guildId => guildFileExists(guildId, FILES.DEVOIRS) || guildFileExists(guildId, FILES.REMINDERS),
  );
}

function getSchemaVersion() {
  return readSchema().version;
}

function writeSchemaVersion(version, extra = {}) {
  return writeJsonAt(SCHEMA_PATH, {
    version,
    updatedAt: new Date().toISOString(),
    ...extra,
  });
}

/**
 * Marque le stockage au schéma courant — mais UNIQUEMENT s'il n'y a rien à
 * migrer.
 *
 * Sans cette précaution, démarrer le bot avant d'avoir lancé la migration
 * tamponnait data/schema.json en v2 alors que les devoirs étaient toujours
 * dans les anciens fichiers. Le script de migration considérait ensuite le
 * travail comme fait et refusait de s'exécuter : les données restaient
 * orphelines, et le tableau vide.
 *
 * Retourne la version effective, pour que l'appelant puisse avertir.
 */
function ensureSchemaVersion() {
  const current = getSchemaVersion();
  if (current >= SCHEMA_VERSION) return current;

  if (hasLegacyData()) return current; // migration encore nécessaire

  writeSchemaVersion(SCHEMA_VERSION);
  return SCHEMA_VERSION;
}

module.exports = {
  DATA_DIR,
  GUILDS_DIR,
  GLOBAL_DIR,
  SCHEMA_PATH,
  SCHEMA_VERSION,
  FILES,
  GLOBAL_FILES,
  isValidGuildId,
  normalizeGuildId,
  getGuildDataPath,
  ensureGuildDir,
  readGuildJson,
  writeGuildJson,
  guildFileExists,
  guildExists,
  listGuildIds,
  readGlobalJson,
  writeGlobalJson,
  LEGACY_FILES,
  hasLegacyData,
  hasBeenMigrated,
  readSchema,
  getSchemaVersion,
  writeSchemaVersion,
  ensureSchemaVersion,
};
