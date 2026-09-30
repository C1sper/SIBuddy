// events/guildDelete.js
// Le bot quitte (ou est retiré d')un serveur.
//
// On ne supprime JAMAIS data/guilds/<guildId>/ automatiquement : un kick
// accidentel, une panne réseau ou une réinstallation ne doivent pas détruire
// les devoirs et les statistiques du serveur. Le nettoyage reste manuel.
const { Events } = require('discord.js');

const { createLogger } = require('../utils/logger');

const log = createLogger('guilds');
module.exports = {
  name: Events.GuildDelete,
  execute(guild) {
    log.info(
      `➖ Bot retiré du serveur ${guild.name || 'inconnu'} (${guild.id}). ` +
      'Les données sont conservées dans data/guilds/ (suppression manuelle uniquement).',
    );
  },
};
