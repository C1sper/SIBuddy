// services/statsStore.js
// Compteur de messages par utilisateur, stocké PAR SERVEUR :
// data/guilds/<guildId>/stats.json
//
// Avant la v2, un unique data/stats.json agrégeait tous les serveurs : /stats
// sur un serveur affichait donc l'activité des membres d'un autre. C'est
// désormais impossible.
//
// Les messages reçus en DM (hors serveur) ne sont plus comptabilisés : ils
// n'appartiennent à aucun serveur et fausseraient les classements.
const { FILES, readGuildJson, writeGuildJson, normalizeGuildId } = require('./guildStore');

const FLUSH_DEBOUNCE_MS = 5_000;

// guildId -> { userId: count }
const cache = new Map();
const dirtyGuilds = new Set();
let flushTimer = null;

function load(guildId) {
  const id = normalizeGuildId(guildId);
  if (!id) return null;

  if (!cache.has(id)) {
    const raw = readGuildJson(id, FILES.STATS, {});
    const counts = {};
    if (raw && typeof raw === 'object') {
      for (const [userId, value] of Object.entries(raw)) {
        const n = Number(value);
        if (/^\d{17,20}$/.test(userId) && Number.isFinite(n) && n > 0) counts[userId] = Math.floor(n);
      }
    }
    cache.set(id, counts);
  }

  return cache.get(id);
}

function scheduleFlush(guildId) {
  dirtyGuilds.add(guildId);
  if (flushTimer) return;

  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_DEBOUNCE_MS);
  flushTimer.unref?.();
}

function flush() {
  for (const guildId of dirtyGuilds) {
    const counts = cache.get(guildId);
    if (counts) writeGuildJson(guildId, FILES.STATS, counts);
  }
  dirtyGuilds.clear();
}

function incrementMessageCount(guildId, userId) {
  const counts = load(guildId);
  if (!counts) return 0;

  counts[userId] = (counts[userId] || 0) + 1;
  scheduleFlush(normalizeGuildId(guildId));
  return counts[userId];
}

function getMessageCount(guildId, userId) {
  const counts = load(guildId);
  return counts ? (counts[userId] || 0) : 0;
}

function getTopUsers(guildId, limit = 5) {
  const counts = load(guildId);
  if (!counts) return [];

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

/** Nombre total de membres suivis sur un serveur (affiché dans le panel). */
function getTrackedUserCount(guildId) {
  const counts = load(guildId);
  return counts ? Object.keys(counts).length : 0;
}

/** Vidage immédiat du cache sur disque (SIGTERM/SIGINT). */
function forceFlush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flush();
}

/** Réinitialise le cache mémoire (tests uniquement). */
function resetCache() {
  cache.clear();
  dirtyGuilds.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

module.exports = {
  incrementMessageCount,
  getMessageCount,
  getTopUsers,
  getTrackedUserCount,
  forceFlush,
  resetCache,
};
