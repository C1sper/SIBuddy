const { Events, MessageFlags } = require('discord.js');
const { handleEventInteraction } = require('../utils/eventInteractions');
const adminPanelHandler = require('../interactions/adminPanelHandler');
const { createLogger } = require('../utils/logger');

const log = createLogger('interactions');

/** "arthus#0001 dans Ma Guilde" — de quoi retrouver qui a fait quoi. */
function who(interaction) {
  const user = interaction.user?.tag || 'inconnu';
  return interaction.guild ? `${user} dans ${interaction.guild.name}` : `${user} en DM`;
}

async function replyError(interaction) {
    try {
        const errorMessage = {
            content: '❌ Une erreur s\'est produite lors de l\'exécution de cette commande !',
            flags: MessageFlags.Ephemeral
        };

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    } catch (responseError) {
        log.error('Impossible de répondre à l\'interaction:', responseError);
        // Si l'interaction a expiré ou a déjà été gérée, on ne peut plus rien faire
    }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {

        if (interaction.isAutocomplete()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command || !command.autocomplete) return;
            try {
                await command.autocomplete(interaction);
            } catch (error) {
                log.error(`Autocomplétion /${interaction.commandName}:`, error);
            }
            return;
        }

        // Gestion des commandes slash
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                log.warn(`Commande inconnue : /${interaction.commandName}`);
                return;
            }

            const startedAt = Date.now();
            try {
                await command.execute(interaction);
                log.info(`/${interaction.commandName} — ${who(interaction)} (${Date.now() - startedAt}ms)`);
            } catch (error) {
                log.error(`/${interaction.commandName} — ${who(interaction)}:`, error);
                await replyError(interaction);
            }
            return;
        }

        const customId = interaction.customId || '';
        const isAdminInteraction = customId.startsWith('admin:');

        // Gestion des boutons
        if (interaction.isButton()) {
            try {
                if (isAdminInteraction) {
                    await adminPanelHandler.route(interaction);
                } else if (customId.startsWith('event_')) {
                    await handleEventInteraction(interaction);
                }
                // Les autres customId (poll_*, events_prev/next, confirm/cancel_delete_*, ...)
                // sont gérés par leurs propres message component collectors.
            } catch (error) {
                log.error(`Bouton ${customId} — ${who(interaction)}:`, error);
                await replyError(interaction);
            }
            return;
        }

        // Gestion des menus déroulants
        if (interaction.isStringSelectMenu()) {
            try {
                if (isAdminInteraction) {
                    await adminPanelHandler.route(interaction);
                }
                // event_details_select est géré par son propre collector.
            } catch (error) {
                log.error(`Menu ${customId} — ${who(interaction)}:`, error);
                await replyError(interaction);
            }
            return;
        }

        // Gestion des soumissions de modals (panel d'administration)
        if (interaction.isModalSubmit()) {
            try {
                if (isAdminInteraction) {
                    await adminPanelHandler.route(interaction);
                }
            } catch (error) {
                log.error(`Modal ${customId} — ${who(interaction)}:`, error);
                await replyError(interaction);
            }
        }
    },
};
