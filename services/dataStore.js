// services/dataStore.js
// Primitives bas niveau d'accès au dossier data/ : chemin absolu stable,
// lecture/écriture JSON sûres, écriture atomique (fichier temporaire + rename),
// mise en quarantaine des fichiers corrompus.
//
// Ce module ne connaît QUE des chemins de fichiers. La répartition logique
// des données (global vs par serveur Discord) est gérée par services/guildStore.js.
const fs = require('fs');
const path = require('path');

const { createLogger } = require('../utils/logger');

const log = createLogger('dataStore');
// BOT_DATA_DIR permet de rediriger tout le stockage ailleurs (tests isolés,
// montage Docker non standard). Par défaut : <racine du projet>/data.
const DATA_DIR = process.env.BOT_DATA_DIR
  ? path.resolve(process.env.BOT_DATA_DIR)
  : path.join(__dirname, '..', 'data');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function ensureDataDir() {
  ensureDir(DATA_DIR);
}

function structuredCloneSafe(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Renomme un fichier illisible en `<nom>.corrupt-<horodatage>` au lieu de le
 * laisser se faire écraser au prochain write. On ne perd jamais de données :
 * le fichier reste sur le disque pour inspection manuelle.
 */
function quarantineCorrupt(filePath, reason) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${filePath}.corrupt-${stamp}`;
    fs.renameSync(filePath, target);
    log.error(
      `${path.basename(filePath)} illisible (${reason}). ` +
      `Conservé sous ${path.basename(target)}, valeurs par défaut utilisées.`,
    );
  } catch (e) {
    log.error(`Impossible de mettre en quarantaine ${filePath}:`, e.message);
  }
}

/**
 * Lit un fichier JSON à un chemin absolu. Retourne `fallback` si le fichier
 * n'existe pas, est vide, ou contient du JSON invalide (mis en quarantaine).
 */
function readJsonAt(filePath, fallback) {
  if (!fs.existsSync(filePath)) return structuredCloneSafe(fallback);

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    log.error(`Erreur lecture ${filePath}:`, e.message);
    return structuredCloneSafe(fallback);
  }

  if (raw.trim().length === 0) return structuredCloneSafe(fallback);

  try {
    return JSON.parse(raw);
  } catch (e) {
    quarantineCorrupt(filePath, e.message);
    return structuredCloneSafe(fallback);
  }
}

/**
 * Écrit un fichier JSON de façon atomique (tmp + rename) à un chemin absolu.
 * Crée le dossier parent si nécessaire. Retourne true/false.
 *
 * Reste synchrone (comme le reste du module) : dans un process Node
 * mono-thread, ça garantit qu'une lecture juste après une écriture voit
 * bien les données à jour, sans file d'attente asynchrone.
 */
function writeJsonAt(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (e) {
    log.error(`Erreur écriture ${filePath}:`, e.message);
    try { fs.unlinkSync(tmpPath); } catch { /* tmp déjà absent */ }
    return false;
  }
}

// Volontairement, ce module n'expose PAS de helper "lire/écrire un fichier à la
// racine de data/". Toute donnée passe soit par services/guildStore.js
// (readGuildJson/writeGuildJson, cloisonnées par serveur), soit par ses
// helpers globaux explicites (readGlobalJson/writeGlobalJson). Ça supprime le
// chemin par lequel un fichier redeviendrait accidentellement global.
module.exports = {
  DATA_DIR,
  ensureDir,
  ensureDataDir,
  readJsonAt,
  writeJsonAt,
  structuredCloneSafe,
};
