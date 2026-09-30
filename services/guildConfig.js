// services/guildConfig.js
// Configuration persistante d'un serveur : data/guilds/<guildId>/config.json.
//
// Un seul fichier regroupe les trois blocs de configuration d'une guild :
//   - features : activation/désactivation des fonctionnalités
//   - feur     : règles de réponse automatique + cooldown
//   - devoirs  : salons du tableau/rappels, rôle mentionné, timings globaux
//
// Fournit des valeurs par défaut sûres, normalise ce qui est chargé, et
// centralise la lecture/écriture pour éviter la duplication.
const { FILES, readGuildJson, writeGuildJson, listGuildIds, normalizeGuildId } = require('./guildStore');

const CONFIG_VERSION = 2;

const DEFAULT_FEUR_RULE = () => ({
  id: 'default-quoi',
  trigger: 'quoi',
  response: 'Feur.',
});

const MIN_COOLDOWN_MINUTES = 0;
const MAX_COOLDOWN_MINUTES = 24 * 60; // 24h, borne raisonnable

function defaultDevoirsConfig() {
  return {
    roleId: null,
    reminderChannelId: null,
    boardChannelId: null,
    boardMessageId: null,
    // Messages supplémentaires du tableau quand il dépasse les limites Discord.
    boardExtraMessageIds: [],
    boardLastUpdate: null,
    customTimings: [],
  };
}

function defaultGuildConfig() {
  return {
    version: CONFIG_VERSION,
    features: {
      feur: true,
      homework: true,
      stats: true,
      rss: true,
      recurringEvents: true,
    },
    feur: {
      cooldownMinutes: 30,
      rules: [DEFAULT_FEUR_RULE()],
    },
    devoirs: defaultDevoirsConfig(),
  };
}

function makeRuleId() {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clampCooldown(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return Math.min(MAX_COOLDOWN_MINUTES, Math.max(MIN_COOLDOWN_MINUTES, Math.round(n)));
}

function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const trigger = String(raw.trigger || '').slice(0, 100).trim();
  const response = String(raw.response || '').slice(0, 500);
  if (!trigger || !response) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeRuleId(),
    trigger,
    response,
  };
}

function normalizeTimings(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(t => t && typeof t === 'object' && Number.isFinite(Number(t.offsetMs)) && Number(t.offsetMs) > 0)
    .map(t => ({ label: String(t.label || '').slice(0, 50) || `${t.offsetMs}ms`, offsetMs: Number(t.offsetMs) }));
}

function normalizeSnowflakeOrNull(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value) ? value : null;
}

function normalizeDevoirsConfig(raw) {
  const defaults = defaultDevoirsConfig();
  if (!raw || typeof raw !== 'object') return defaults;

  return {
    roleId: normalizeSnowflakeOrNull(raw.roleId),
    reminderChannelId: normalizeSnowflakeOrNull(raw.reminderChannelId),
    boardChannelId: normalizeSnowflakeOrNull(raw.boardChannelId),
    boardMessageId: normalizeSnowflakeOrNull(raw.boardMessageId),
    boardExtraMessageIds: Array.isArray(raw.boardExtraMessageIds)
      ? raw.boardExtraMessageIds.map(normalizeSnowflakeOrNull).filter(Boolean)
      : [],
    boardLastUpdate: typeof raw.boardLastUpdate === 'string' ? raw.boardLastUpdate : null,
    customTimings: normalizeTimings(raw.customTimings),
  };
}

function normalizeGuildConfig(raw) {
  const defaults = defaultGuildConfig();
  if (!raw || typeof raw !== 'object') return defaults;

  const features = {
    ...defaults.features,
    ...(raw.features && typeof raw.features === 'object' ? raw.features : {}),
  };
  for (const key of Object.keys(features)) features[key] = Boolean(features[key]);

  const rawFeur = raw.feur && typeof raw.feur === 'object' ? raw.feur : {};
  const rules = Array.isArray(rawFeur.rules) ? rawFeur.rules.map(normalizeRule).filter(Boolean) : [];

  return {
    version: CONFIG_VERSION,
    features,
    feur: {
      cooldownMinutes: clampCooldown(rawFeur.cooldownMinutes ?? defaults.feur.cooldownMinutes),
      rules: rules.length > 0 ? rules : [DEFAULT_FEUR_RULE()],
    },
    devoirs: normalizeDevoirsConfig(raw.devoirs),
  };
}

// ---------------------------------------------------------------------------
// Accès disque
// ---------------------------------------------------------------------------

/** Lecture normalisée du config.json d'un serveur (ne persiste rien). */
function getGuildConfig(guildId) {
  return normalizeGuildConfig(readGuildJson(guildId, FILES.CONFIG, null));
}

/**
 * Comme getGuildConfig(), mais crée et persiste une configuration par défaut
 * si le serveur n'en a pas encore. Point d'entrée de l'initialisation d'une
 * nouvelle guild.
 */
function ensureGuildConfig(guildId) {
  const id = normalizeGuildId(guildId);
  if (!id) return defaultGuildConfig();

  const raw = readGuildJson(id, FILES.CONFIG, null);
  if (!raw) {
    const fresh = defaultGuildConfig();
    writeGuildJson(id, FILES.CONFIG, fresh);
    return fresh;
  }
  return normalizeGuildConfig(raw);
}

/**
 * Applique un mutateur sur la config d'un serveur et persiste le résultat.
 * Le mutateur reçoit une copie normalisée et peut la modifier en place.
 */
function updateGuildConfig(guildId, mutator) {
  const current = getGuildConfig(guildId);
  const updated = normalizeGuildConfig(mutator(current) || current);
  writeGuildJson(guildId, FILES.CONFIG, updated);
  return updated;
}

function isFeatureEnabled(guildId, feature) {
  return getGuildConfig(guildId).features[feature] !== false;
}

// ---------------------------------------------------------------------------
// Bloc "devoirs" (utilisé par devoirsService, le board et les commandes de config)
// ---------------------------------------------------------------------------

function getDevoirsConfig(guildId) {
  return getGuildConfig(guildId).devoirs;
}

/** Fusionne un patch partiel dans le bloc devoirs et persiste. */
function patchDevoirsConfig(guildId, patch) {
  return updateGuildConfig(guildId, (cfg) => {
    cfg.devoirs = normalizeDevoirsConfig({ ...cfg.devoirs, ...(patch || {}) });
    return cfg;
  }).devoirs;
}

module.exports = {
  CONFIG_VERSION,
  defaultGuildConfig,
  defaultDevoirsConfig,
  normalizeGuildConfig,
  normalizeDevoirsConfig,
  DEFAULT_FEUR_RULE,
  MIN_COOLDOWN_MINUTES,
  MAX_COOLDOWN_MINUTES,
  clampCooldown,
  normalizeRule,
  getGuildConfig,
  ensureGuildConfig,
  updateGuildConfig,
  isFeatureEnabled,
  getDevoirsConfig,
  patchDevoirsConfig,
  listGuildIds,
};
