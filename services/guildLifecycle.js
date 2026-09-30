// services/guildLifecycle.js
// Initialisation des données d'un serveur. Aucun dossier n'a jamais besoin
// d'être créé à la main : la première utilisation suffit.
const { ensureGuildDir, normalizeGuildId, ensureSchemaVersion, guildExists } = require('./guildStore');
const { ensureGuildConfig } = require('./guildConfig');
const categoriesService = require('./categoriesService');

const { createLogger } = require('../utils/logger');

const log = createLogger('guildLifecycle');
/**
 * Crée (si besoin) data/guilds/<guildId>/ avec sa configuration par défaut et
 * ses catégories par défaut. Idempotent : ne réécrit rien si tout existe déjà.
 */
function ensureGuildInitialized(guildId) {
  const id = normalizeGuildId(guildId);
  if (!id) return false;

  const isNew = !guildExists(id);

  ensureSchemaVersion();
  ensureGuildDir(id);
  ensureGuildConfig(id);
  categoriesService.listCategories(id); // crée les catégories par défaut au besoin

  if (isNew) log.info(`Données initialisées pour le serveur ${id}.`);
  return true;
}

/** Initialise tous les serveurs déjà connus du client (au démarrage). */
function ensureAllGuildsInitialized(client) {
  let count = 0;
  for (const guildId of client.guilds.cache.keys()) {
    if (ensureGuildInitialized(guildId)) count++;
  }
  return count;
}

module.exports = { ensureGuildInitialized, ensureAllGuildsInitialized };
