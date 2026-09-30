// events/guildCreate.js
// Le bot rejoint un serveur : on prépare immédiatement son dossier de données
// (configuration + catégories par défaut).
const { Events } = require('discord.js');
const { ensureGuildInitialized } = require('../services/guildLifecycle');

const { createLogger } = require('../utils/logger');

const log = createLogger('guilds');
module.exports = {
  name: Events.GuildCreate,
  execute(guild) {
    ensureGuildInitialized(guild.id);
    log.info(`➕ Bot ajouté au serveur ${guild.name} (${guild.id}).`);
  },
};
