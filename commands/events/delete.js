const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, MessageFlags } = require('discord.js');
const { readEventsConfig, writeEventsConfig } = require('../../services/eventsConfigStore');

const { createLogger } = require('../../utils/logger');

const log = createLogger('commands');
/**
 * =============================================
 * COMMANDE EVENT-DELETE - Suppression d'événements
 * =============================================
 * 
 * Fonction : Supprime un événement existant
 * 
 * Fonctionnalités :
 * - Suppression sécurisée avec confirmation
 * - Vérification des permissions (créateur ou admin)
 * - Notification automatique des participants
 * - Suppression de l'événement Discord natif associé
 * - Nettoyage des rappels programmés
 * 
 * Paramètres :
 * - event-id : ID de l'événement à supprimer (requis)
 * - force : Forcer la suppression sans confirmation (optionnel, admin seulement)
 * 
 * Usage : /event-delete event-id:"abc123" [force:true]
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('event-delete')
        .setDescription('Supprime un événement existant')
        .addStringOption(option =>
            option
                .setName('event-id')
                .setDescription('ID de l\'événement à supprimer')
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName('force')
                .setDescription('Forcer la suppression sans confirmation (admin seulement)')
                .setRequired(false)
        ),
    emoji: '🗑️',

    async execute(interaction) {
        const eventId = interaction.options.getString('event-id');
        const force = interaction.options.getBoolean('force') || false;

        await interaction.deferReply();

        try {
            // Charger la configuration des événements
            const eventsConfig = loadEventsConfig();
            const event = eventsConfig.events[interaction.guildId]?.[eventId];

            if (!event) {
                return await interaction.editReply({
                    content: '❌ Aucun événement trouvé avec cet ID. Utilisez `/event-list` pour voir les événements disponibles.'
                });
            }

            // Vérifier les permissions
            const isCreator = event.creatorId === interaction.user.id;
            const isAdmin = interaction.member.permissions.has('Administrator');
            const canManageEvents = interaction.member.permissions.has('ManageEvents');

            if (!isCreator && !isAdmin && !canManageEvents) {
                return await interaction.editReply({
                    content: '❌ Vous ne pouvez supprimer que vos propres événements, ou vous devez avoir les permissions d\'administrateur/gestion d\'événements.'
                });
            }

            // Si force est activé, vérifier que l'utilisateur est admin
            if (force && !isAdmin) {
                return await interaction.editReply({
                    content: '❌ Seuls les administrateurs peuvent utiliser la suppression forcée.'
                });
            }

            // Créer l'embed d'information sur l'événement à supprimer
            const eventDate = new Date(event.dateTime);
            const timestamp = Math.floor(eventDate.getTime() / 1000);
            const participantCount = event.participants.attending.length + 
                                   event.participants.maybe.length + 
                                   event.participants.notAttending.length;

            const confirmEmbed = new EmbedBuilder()
                .setColor(0xff6b6b)
                .setTitle('🗑️ Confirmation de suppression')
                .setDescription(`Êtes-vous sûr de vouloir supprimer cet événement ?`)
                .addFields(
                    { name: '📅 Événement', value: event.title, inline: false },
                    { name: '📝 Description', value: event.description.substring(0, 200) + (event.description.length > 200 ? '...' : ''), inline: false },
                    { name: '📅 Date', value: `<t:${timestamp}:F>`, inline: true },
                    { name: '👥 Participants', value: `${participantCount} personnes concernées`, inline: true }
                )
                .setFooter({ 
                    text: `ID: ${eventId}`,
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            // Si suppression forcée, supprimer directement
            if (force) {
                await deleteEvent(interaction, event, eventsConfig, eventId);
                return;
            }

            // Sinon, demander confirmation
            const confirmButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`confirm_delete_${eventId}`)
                        .setLabel('🗑️ Confirmer la suppression')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`cancel_delete_${eventId}`)
                        .setLabel('❌ Annuler')
                        .setStyle(ButtonStyle.Secondary)
                );

            const message = await interaction.editReply({
                embeds: [confirmEmbed],
                components: [confirmButtons]
            });

            // Gérer les interactions de confirmation
            const collector = message.createMessageComponentCollector({
                time: 30000 // 30 secondes pour confirmer
            });

            collector.on('collect', async (buttonInteraction) => {
                if (buttonInteraction.user.id !== interaction.user.id) {
                    return buttonInteraction.reply({
                        content: '❌ Seul l\'utilisateur qui a lancé la commande peut confirmer.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                if (buttonInteraction.customId === `confirm_delete_${eventId}`) {
                    await deleteEvent(buttonInteraction, event, eventsConfig, eventId);
                } else {
                    await buttonInteraction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0x95a5a6)
                                .setTitle('❌ Suppression annulée')
                                .setDescription(`L'événement **${event.title}** n'a pas été supprimé.`)
                                .setTimestamp()
                        ],
                        components: []
                    });
                }

                collector.stop();
            });

            collector.on('end', async (collected) => {
                if (collected.size === 0) {
                    try {
                        await interaction.editReply({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(0x95a5a6)
                                    .setTitle('⏰ Temps écoulé')
                                    .setDescription('La suppression a été annulée (temps d\'attente dépassé).')
                                    .setTimestamp()
                            ],
                            components: []
                        });
                    } catch (error) {
                        // Ignorer si le message a été supprimé
                    }
                }
            });

        } catch (error) {
            log.error('Erreur lors de la suppression de l\'événement:', error);
            await interaction.editReply({
                content: '❌ Une erreur est survenue lors de la suppression de l\'événement.'
            });
        }
    }
};

/**
 * Supprime effectivement l'événement et nettoie toutes les références
 */
async function deleteEvent(interaction, event, eventsConfig, eventId) {
    try {
        // Notifier les participants avant suppression
        await notifyParticipants(interaction, event);

        // Supprimer le message d'événement
        try {
            const channel = await interaction.client.channels.fetch(event.channelId);
            const message = await channel.messages.fetch(event.messageId);
            await message.delete();
        } catch (error) {
            log.info('Impossible de supprimer le message d\'événement:', error.message);
        }

        // Supprimer l'événement Discord natif si il existe
        if (event.discordEventId) {
            try {
                const discordEvent = await interaction.guild.scheduledEvents.fetch(event.discordEventId);
                await discordEvent.delete();
            } catch (error) {
                log.info('Impossible de supprimer l\'événement Discord natif:', error.message);
            }
        }

        // Supprimer les rappels programmés
        if (interaction.client.reminderSystem) {
            interaction.client.reminderSystem.cancelReminders(eventId);
        }

        // Supprimer l'événement de la configuration
        delete eventsConfig.events[interaction.guildId][eventId];
        saveEventsConfig(eventsConfig);

        // Confirmer la suppression
        const successEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Événement supprimé')
            .setDescription(`L'événement **${event.title}** a été supprimé avec succès.`)
            .addFields(
                { name: '👥 Participants notifiés', value: `${event.participants.attending.length + event.participants.maybe.length} personne(s)`, inline: true }
            )
            .setTimestamp();

        if (interaction.deferred) {
            await interaction.editReply({
                embeds: [successEmbed],
                components: []
            });
        } else {
            await interaction.update({
                embeds: [successEmbed],
                components: []
            });
        }

        log.info(`Événement supprimé: ${event.title} (${eventId}) par ${interaction.user.tag}`);

    } catch (error) {
        log.error('Erreur lors de la suppression effective:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('❌ Erreur de suppression')
            .setDescription('Une erreur est survenue lors de la suppression de l\'événement.')
            .setTimestamp();

        if (interaction.deferred) {
            await interaction.editReply({
                embeds: [errorEmbed],
                components: []
            });
        } else {
            await interaction.update({
                embeds: [errorEmbed],
                components: []
            });
        }
    }
}

/**
 * Notifie les participants de la suppression de l'événement
 */
async function notifyParticipants(interaction, event) {
    const participantsToNotify = [
        ...event.participants.attending,
        ...event.participants.maybe
    ];

    if (participantsToNotify.length === 0) return;

    const notificationEmbed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('📅 Événement annulé')
        .setDescription(`L'événement **${event.title}** auquel vous étiez inscrit a été annulé.`)
        .addFields(
            { name: '📅 Date prévue', value: `<t:${Math.floor(new Date(event.dateTime).getTime() / 1000)}:F>`, inline: true },
            { name: '👤 Annulé par', value: `${interaction.user.tag}`, inline: true }
        )
        .setFooter({ 
            text: 'Notification automatique du bot événements',
            iconURL: interaction.client.user.displayAvatarURL()
        })
        .setTimestamp();

    // Envoyer les notifications en parallèle (max 5 à la fois pour éviter le rate limit)
    const chunks = [];
    for (let i = 0; i < participantsToNotify.length; i += 5) {
        chunks.push(participantsToNotify.slice(i, i + 5));
    }

    for (const chunk of chunks) {
        const promises = chunk.map(async (userId) => {
            try {
                const user = await interaction.client.users.fetch(userId);
                await user.send({ embeds: [notificationEmbed] });
            } catch (error) {
                log.info(`Impossible de notifier l'utilisateur ${userId}:`, error.message);
            }
        });

        await Promise.all(promises);
        
        // Petite pause entre les chunks
        if (chunks.indexOf(chunk) < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

// Fonctions utilitaires

function loadEventsConfig() {
    return readEventsConfig();
}

function saveEventsConfig(config) {
    writeEventsConfig(config);
}
