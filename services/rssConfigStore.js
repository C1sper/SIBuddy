// services/rssConfigStore.js
// Configuration RSS, stockée par serveur : data/guilds/<guildId>/rss-config.json
//
// Ce module expose volontairement la MÊME forme agrégée qu'avant la v2 —
// { [guildId]: { [feedId]: feedConfig } } — pour que /rss-setup, /rss-list et
// /rss-remove continuent de fonctionner sans modification. L'agrégation et
// l'éclatement vers les fichiers par serveur sont entièrement internes.
const { FILES, readGuildJson, writeGuildJson, listGuildIds, normalizeGuildId } = require('./guildStore');

function readGuildFeeds(guildId) {
  const raw = readGuildJson(guildId, FILES.RSS_CONFIG, { feeds: {} });
  const feeds = raw && typeof raw.feeds === 'object' && raw.feeds ? raw.feeds : {};
  return { ...feeds };
}

function writeGuildFeeds(guildId, feeds) {
  return writeGuildJson(guildId, FILES.RSS_CONFIG, { version: 2, feeds: feeds || {} });
}

/** Vue agrégée { [guildId]: { [feedId]: config } } de tous les serveurs. */
function readRssConfig() {
  const config = {};
  for (const guildId of listGuildIds()) {
    const feeds = readGuildFeeds(guildId);
    if (Object.keys(feeds).length > 0) config[guildId] = feeds;
  }
  return config;
}

/**
 * Réécrit la configuration RSS à partir de la vue agrégée.
 * Un serveur absent de l'objet (cas de /rss-remove qui supprime la clé quand
 * le dernier flux part) voit ses flux vidés — sans que son dossier de données
 * ni le reste de sa configuration soient touchés.
 */
function writeRssConfig(config) {
  const incoming = config && typeof config === 'object' ? config : {};
  const guildIds = new Set([...listGuildIds(), ...Object.keys(incoming)]);

  for (const guildId of guildIds) {
    if (!normalizeGuildId(guildId)) continue;

    const feeds = incoming[guildId] && typeof incoming[guildId] === 'object' ? incoming[guildId] : {};
    const current = readGuildFeeds(guildId);

    // N'écrit que si le contenu change réellement.
    if (JSON.stringify(current) === JSON.stringify(feeds)) continue;
    writeGuildFeeds(guildId, feeds);
  }
}

// ---------------------------------------------------------------------------
// État de lecture des flux (articles déjà vus), également par serveur
// ---------------------------------------------------------------------------

function readRssState(guildId) {
  const raw = readGuildJson(guildId, FILES.RSS_STATE, { feeds: {} });
  if (!raw || typeof raw !== 'object' || typeof raw.feeds !== 'object' || !raw.feeds) {
    return { feeds: {} };
  }
  return raw;
}

function writeRssState(guildId, state) {
  return writeGuildJson(guildId, FILES.RSS_STATE, { version: 2, feeds: state?.feeds || {} });
}

module.exports = {
  readRssConfig,
  writeRssConfig,
  readGuildFeeds,
  writeGuildFeeds,
  readRssState,
  writeRssState,
};
