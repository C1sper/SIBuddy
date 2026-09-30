const { Events } = require('discord.js');
const statsStore = require('../services/statsStore');
const feurEngine = require('../services/feurEngine');
const { isFeatureEnabled } = require('../services/guildConfig');

const { createLogger } = require('../utils/logger');

const log = createLogger('messages');
module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    // Ignorer les bots et les webhooks
    if (message.author.bot || message.webhookId) return;

    // Hors serveur (DM), il n'y a aucune guild à qui rattacher le message :
    // ni statistiques, ni réponses automatiques.
    if (!message.guildId) return;

    // --- Statistiques (comptées par serveur) ---
    if (isFeatureEnabled(message.guildId, 'stats')) {
      statsStore.incrementMessageCount(message.guildId, message.author.id);
    }

    // --- Réponses "feur" configurables ---

    const response = feurEngine.evaluateMessage(message.guildId, message.author.id, message.content);
    if (!response) return;

    try {
      await message.reply({
        content: response,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      log.error('Erreur lors de l\'envoi de la réponse feur :', error.message);
    }
  },
};
