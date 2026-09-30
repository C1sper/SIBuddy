const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle 
} = require('discord.js');
const { readEventsConfig, writeEventsConfig } = require('../../services/eventsConfigStore');

const { createLogger } = require('../../utils/logger');

const log = createLogger('commands');
/**
 * ==========================================
 * COMMANDE EVENT-EDIT - Modification d'événements
 * ==========================================
 * 
 * Fonction : Permet de modifier un événement existant
 * 
 * Fonctionnalités :
 * - Modification du titre, description, date/heure
 * - Changement de la limite de participants
 * - Modification de la récurrence
 * - Vérification des permissions (créateur ou admin)
 * - Notification automatique des participants des changements
 * - Mise à jour de l'événement Discord natif
 * 
 * Paramètres :
 * - event-id : ID de l'événement à modifier (requis)
 * - titre : Nouveau titre (optionnel)
 * - description : Nouvelle description (optionnel)
 * - date : Nouvelle date DD/MM/YYYY (optionnel)
 * - heure : Nouvelle heure HH:MM (optionnel)
 * - limite : Nouvelle limite de participants (optionnel)
 * 
 * Usage : /event-edit event-id:"abc123" titre:"Nouveau titre" date:"26/10/2025"
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('event-edit')
        .setDescription('Modifie un événement existant')
        .addStringOption(option =>
            option
                .setName('event-id')
                .setDescription('ID de l\'événement à modifier')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('titre')
                .setDescription('Nouveau titre de l\'événement')
                .setMaxLength(100)
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('description')
                .setDescription('Nouvelle description de l\'événement')
                .setMaxLength(1000)
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('date')
                .setDescription('Nouvelle date (format: DD/MM/YYYY)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('heure')
                .setDescription('Nouvelle heure (format: HH:MM)')
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option
                .setName('limite')
                .setDescription('Nouvelle limite de participants')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('recurrence')
                .setDescription('Nouveau type de récurrence')
                .addChoices(
                    { name: 'Aucune', value: 'none' },
                    { name: 'Hebdomadaire', value: 'weekly' },
                    { name: 'Mensuelle', value: 'monthly' }
                )
                .setRequired(false)
        ),
    emoji: '✏️',

    async execute(interaction) {
        const eventId = interaction.options.getString('event-id');
        const newTitle = interaction.options.getString('titre');
        const newDescription = interaction.options.getString('description');
        const newDate = interaction.options.getString('date');
        const newTime = interaction.options.getString('heure');
        const newLimit = interaction.options.getInteger('limite');
        const newRecurrence = interaction.options.getString('recurrence');

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
                    content: '❌ Vous ne pouvez modifier que vos propres événements, ou vous devez avoir les permissions d\'administrateur/gestion d\'événements.'
                });
            }

            // Vérifier qu'au moins un paramètre à modifier a été fourni
            if (!newTitle && !newDescription && !newDate && !newTime && !newLimit && !newRecurrence) {
                return await interaction.editReply({
                    content: '❌ Vous devez spécifier au moins un élément à modifier (titre, description, date, heure, limite ou récurrence).'
                });
            }

            // Sauvegarder les anciennes valeurs pour comparaison
            const oldEvent = { ...event };
            const changes = [];

            // Appliquer les modifications
            if (newTitle) {
                event.title = newTitle;
                changes.push(`**Titre:** ${oldEvent.title} → ${newTitle}`);
            }

            if (newDescription) {
                event.description = newDescription;
                changes.push(`**Description:** Modifiée`);
            }

            if (newDate || newTime) {
                const dateStr = newDate || formatDateFromISO(event.dateTime);
                const timeStr = newTime || formatTimeFromISO(event.dateTime);
                
                const newDateTime = parseDateTime(dateStr, timeStr);
                if (!newDateTime) {
                    return await interaction.editReply({
                        content: '❌ Format de date/heure invalide. Utilisez DD/MM/YYYY pour la date et HH:MM pour l\'heure.'
                    });
                }

                // Vérifier que la nouvelle date est dans le futur
                if (newDateTime <= new Date()) {
                    return await interaction.editReply({
                        content: '❌ La nouvelle date de l\'événement doit être dans le futur.'
                    });
                }

                const oldDateTime = new Date(event.dateTime);
                event.dateTime = newDateTime.toISOString();
                changes.push(`**Date:** <t:${Math.floor(oldDateTime.getTime() / 1000)}:F> → <t:${Math.floor(newDateTime.getTime() / 1000)}:F>`);
            }

            if (newLimit !== null) {
                // Vérifier que la nouvelle limite n'est pas inférieure au nombre actuel de participants
                const currentParticipants = event.participants.attending.length;
                if (newLimit < currentParticipants) {
                    return await interaction.editReply({
                        content: `❌ La nouvelle limite (${newLimit}) ne peut pas être inférieure au nombre actuel de participants (${currentParticipants}).`
                    });
                }

                changes.push(`**Limite de participants:** ${event.maxParticipants} → ${newLimit}`);
                event.maxParticipants = newLimit;
            }

            if (newRecurrence) {
                const oldRecurrenceLabel = getRecurrenceLabel(event.recurrence);
                const newRecurrenceLabel = getRecurrenceLabel(newRecurrence);
                event.recurrence = newRecurrence;
                changes.push(`**Récurrence:** ${oldRecurrenceLabel} → ${newRecurrenceLabel}`);
            }

            // Sauvegarder les modifications
            eventsConfig.events[interaction.guildId][eventId] = event;
            saveEventsConfig(eventsConfig);

            // Mettre à jour le message d'événement
            await updateEventMessage(interaction, event);

            // Mettre à jour l'événement Discord natif si il existe
            if (event.discordEventId) {
                await updateDiscordEvent(interaction, event);
            }

            // Mettre à jour les rappels si la date a changé
            if (newDate || newTime) {
                if (interaction.client.reminderSystem) {
                    interaction.client.reminderSystem.updateReminders(event);
                }
            }

            // Notifier les participants des changements importants
            if (newDate || newTime || newTitle) {
                await notifyParticipantsOfChanges(interaction, event, changes);
            }

            // Créer l'embed de confirmation
            const successEmbed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('✅ Événement modifié')
                .setDescription(`L'événement **${event.title}** a été modifié avec succès.`)
                .addFields({
                    name: '📝 Modifications apportées',
                    value: changes.join('\n'),
                    inline: false
                })
                .setFooter({ 
                    text: `ID: ${eventId} • Modifié par ${interaction.user.tag}`,
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

            log.info(`Événement modifié: ${event.title} (${eventId}) par ${interaction.user.tag}`);

        } catch (error) {
            log.error('Erreur lors de la modification de l\'événement:', error);
            await interaction.editReply({
                content: '❌ Une erreur est survenue lors de la modification de l\'événement.'
            });
        }
    }
};

/**
 * Met à jour le message d'événement avec les nouvelles données
 */
async function updateEventMessage(interaction, event) {
    try {
        const channel = await interaction.client.channels.fetch(event.channelId);
        const message = await channel.messages.fetch(event.messageId);
        
        const updatedEmbed = createEventEmbed(event, interaction.client);
        const rsvpButtons = createRSVPButtons(event.id);
        
        await message.edit({
            embeds: [updatedEmbed],
            components: [rsvpButtons]
        });
    } catch (error) {
        log.error('Erreur lors de la mise à jour du message d\'événement:', error);
    }
}

/**
 * Met à jour l'événement Discord natif
 */
async function updateDiscordEvent(interaction, event) {
    try {
        const discordEvent = await interaction.guild.scheduledEvents.fetch(event.discordEventId);
        
        await discordEvent.edit({
            name: event.title,
            description: event.description,
            scheduledStartTime: new Date(event.dateTime)
        });
    } catch (error) {
        log.info('Impossible de mettre à jour l\'événement Discord natif:', error.message);
    }
}

/**
 * Notifie les participants des changements importants
 */
async function notifyParticipantsOfChanges(interaction, event, changes) {
    const participantsToNotify = [
        ...event.participants.attending,
        ...event.participants.maybe
    ];

    if (participantsToNotify.length === 0) return;

    const notificationEmbed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle('📅 Événement modifié')
        .setDescription(`L'événement **${event.title}** auquel vous êtes inscrit a été modifié.`)
        .addFields(
            {
                name: '📝 Modifications',
                value: changes.join('\n'),
                inline: false
            },
            {
                name: '📅 Nouvelle date',
                value: `<t:${Math.floor(new Date(event.dateTime).getTime() / 1000)}:F>`,
                inline: true
            },
            {
                name: '👤 Modifié par',
                value: `${interaction.user.tag}`,
                inline: true
            }
        )
        .setFooter({ 
            text: 'Notification automatique du bot événements',
            iconURL: interaction.client.user.displayAvatarURL()
        })
        .setTimestamp();

    // Envoyer les notifications en parallèle (max 5 à la fois)
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
        
        if (chunks.indexOf(chunk) < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

// Fonctions utilitaires

function parseDateTime(dateStr, timeStr) {
    try {
        const [day, month, year] = dateStr.split('/').map(Number);
        const [hours, minutes] = timeStr.split(':').map(Number);
        
        if (!day || !month || !year || hours === undefined || minutes === undefined) {
            return null;
        }
        
        const date = new Date(year, month - 1, day, hours, minutes);
        
        if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getFullYear() !== year) {
            return null;
        }
        
        return date;
    } catch (error) {
        return null;
    }
}

function formatDateFromISO(isoString) {
    const date = new Date(isoString);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function formatTimeFromISO(isoString) {
    const date = new Date(isoString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

function loadEventsConfig() {
    return readEventsConfig();
}

function saveEventsConfig(config) {
    writeEventsConfig(config);
}

function createEventEmbed(eventData, client) {
    const eventDate = new Date(eventData.dateTime);
    const timestamp = Math.floor(eventDate.getTime() / 1000);
    const isUpcoming = eventDate > new Date();
    
    const embed = new EmbedBuilder()
        .setColor(isUpcoming ? 0x5865f2 : 0x747f8d)
        .setTitle(`📅 ${eventData.title}`)
        .setDescription(eventData.description)
        .addFields(
            { 
                name: '📅 Date et heure', 
                value: `<t:${timestamp}:F>\n<t:${timestamp}:R>`, 
                inline: false 
            },
            { 
                name: '✅ Participants', 
                value: `${eventData.participants.attending.length}/${eventData.maxParticipants}`, 
                inline: true 
            },
            { 
                name: '❓ Peut-être', 
                value: `${eventData.participants.maybe.length}`, 
                inline: true 
            },
            { 
                name: '❌ Absents', 
                value: `${eventData.participants.notAttending.length}`, 
                inline: true 
            }
        )
        .setFooter({ 
            text: `ID: ${eventData.id} • Créé par ${client.users.cache.get(eventData.creatorId)?.tag || 'Utilisateur inconnu'}`,
            iconURL: client.user.displayAvatarURL()
        })
        .setTimestamp();

    if (eventData.recurrence !== 'none') {
        embed.addFields({
            name: '🔄 Récurrence',
            value: getRecurrenceLabel(eventData.recurrence),
            inline: true
        });
    }

    if (!isUpcoming) {
        embed.setTitle(`📅 ${eventData.title} (Terminé)`);
    }

    return embed;
}

function createRSVPButtons(eventId) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`event_attend_${eventId}`)
                .setLabel('✅ Je participe')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`event_maybe_${eventId}`)
                .setLabel('❓ Peut-être')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`event_decline_${eventId}`)
                .setLabel('❌ Je ne peux pas')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`event_info_${eventId}`)
                .setLabel('ℹ️ Détails')
                .setStyle(ButtonStyle.Primary)
        );
}

function getRecurrenceLabel(recurrence) {
    switch (recurrence) {
        case 'weekly': return '🔄 Hebdomadaire';
        case 'monthly': return '🔄 Mensuelle';
        default: return '➡️ Unique';
    }
}
