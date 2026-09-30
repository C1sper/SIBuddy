const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { readEventsConfig, writeEventsConfig } = require('../services/eventsConfigStore');

const { createLogger } = require('../utils/logger');

const log = createLogger('events');
/**
 * ================================================
 * GESTIONNAIRE D'INTERACTIONS - Système d'événements
 * ================================================
 * 
 * Fonction : Gère toutes les interactions liées aux événements
 * 
 * Fonctionnalités :
 * - Gestion des boutons RSVP (Participer/Peut-être/Absent)
 * - Mise à jour en temps réel des participants
 * - Vérification des limites de participants
 * - Prévention des doublons de participation
 * - Affichage des détails d'événements
 * - Notifications automatiques
 * 
 * Types d'interactions gérées :
 * - event_attend_* : Confirmer la participation
 * - event_maybe_* : Marquer comme "peut-être"
 * - event_decline_* : Décliner la participation
 * - event_info_* : Afficher les détails complets
 */

/**
 * Gestionnaire principal des interactions d'événements
 * @param {Interaction} interaction - L'interaction Discord
 */
async function handleEventInteraction(interaction) {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    
    // Vérifier si c'est une interaction d'événement
    const eventInteractionTypes = ['event_attend_', 'event_maybe_', 'event_decline_', 'event_info_'];
    const isEventInteraction = eventInteractionTypes.some(type => customId.startsWith(type));
    
    if (!isEventInteraction) return;

    // Extraire l'ID de l'événement et le type d'action
    const parts = customId.split('_');
    if (parts.length < 3) return;
    
    const action = parts[1]; // attend, maybe, decline, info
    const eventId = parts.slice(2).join('_'); // Reconstituer l'ID complet

    try {
        // Charger la configuration des événements
        const eventsConfig = loadEventsConfig();
        const event = eventsConfig.events[interaction.guildId]?.[eventId];

        if (!event) {
            return await interaction.reply({
                content: '❌ Cet événement n\'existe plus ou a été supprimé.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Vérifier si l'événement est passé
        const eventDate = new Date(event.dateTime);
        const now = new Date();
        
        if (eventDate <= now && action !== 'info') {
            return await interaction.reply({
                content: '❌ Cet événement est déjà passé, vous ne pouvez plus modifier votre participation.',
                flags: MessageFlags.Ephemeral
            });
        }

        switch (action) {
            case 'attend':
                await handleAttendEvent(interaction, event, eventsConfig);
                break;
            case 'maybe':
                await handleMaybeEvent(interaction, event, eventsConfig);
                break;
            case 'decline':
                await handleDeclineEvent(interaction, event, eventsConfig);
                break;
            case 'info':
                await handleEventInfo(interaction, event);
                break;
        }

    } catch (error) {
        log.error('Erreur lors du traitement de l\'interaction d\'événement:', error);
        await interaction.reply({
            content: '❌ Une erreur est survenue lors du traitement de votre demande.',
            flags: MessageFlags.Ephemeral
        });
    }
}

/**
 * Gère la confirmation de participation à un événement
 */
async function handleAttendEvent(interaction, event, eventsConfig) {
    const userId = interaction.user.id;
    
    // Vérifier si l'utilisateur participe déjà
    if (event.participants.attending.includes(userId)) {
        return await interaction.reply({
            content: '✅ Vous participez déjà à cet événement!',
            flags: MessageFlags.Ephemeral
        });
    }

    // Vérifier la limite de participants
    if (event.participants.attending.length >= event.maxParticipants) {
        return await interaction.reply({
            content: `❌ Cet événement est complet (${event.maxParticipants}/${event.maxParticipants} participants).`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Retirer l'utilisateur des autres listes
    removeUserFromAllLists(event.participants, userId);
    
    // Ajouter à la liste des participants
    event.participants.attending.push(userId);

    // Sauvegarder les modifications
    eventsConfig.events[interaction.guildId][event.id] = event;
    saveEventsConfig(eventsConfig);

    // Mettre à jour le message d'événement
    await updateEventMessage(interaction, event);

    // Confirmer à l'utilisateur
    await interaction.reply({
        content: `✅ Parfait! Vous participez maintenant à **${event.title}**.`,
        flags: MessageFlags.Ephemeral
    });

    // Notifier le créateur si c'est le premier participant
    if (event.participants.attending.length === 1) {
        await notifyEventCreator(interaction, event, 'first_participant');
    }
}

/**
 * Gère la participation "peut-être" à un événement
 */
async function handleMaybeEvent(interaction, event, eventsConfig) {
    const userId = interaction.user.id;
    
    // Vérifier si l'utilisateur est déjà en "peut-être"
    if (event.participants.maybe.includes(userId)) {
        return await interaction.reply({
            content: '❓ Vous êtes déjà marqué comme "peut-être" pour cet événement!',
            flags: MessageFlags.Ephemeral
        });
    }

    // Retirer l'utilisateur des autres listes
    removeUserFromAllLists(event.participants, userId);
    
    // Ajouter à la liste "peut-être"
    event.participants.maybe.push(userId);

    // Sauvegarder les modifications
    eventsConfig.events[interaction.guildId][event.id] = event;
    saveEventsConfig(eventsConfig);

    // Mettre à jour le message d'événement
    await updateEventMessage(interaction, event);

    // Confirmer à l'utilisateur
    await interaction.reply({
        content: `❓ Noté! Vous êtes marqué comme "peut-être" pour **${event.title}**.`,
        flags: MessageFlags.Ephemeral
    });
}

/**
 * Gère le refus de participation à un événement
 */
async function handleDeclineEvent(interaction, event, eventsConfig) {
    const userId = interaction.user.id;
    
    // Vérifier si l'utilisateur a déjà décliné
    if (event.participants.notAttending.includes(userId)) {
        return await interaction.reply({
            content: '❌ Vous avez déjà décliné cet événement!',
            flags: MessageFlags.Ephemeral
        });
    }

    // Retirer l'utilisateur des autres listes
    removeUserFromAllLists(event.participants, userId);
    
    // Ajouter à la liste des absents
    event.participants.notAttending.push(userId);

    // Sauvegarder les modifications
    eventsConfig.events[interaction.guildId][event.id] = event;
    saveEventsConfig(eventsConfig);

    // Mettre à jour le message d'événement
    await updateEventMessage(interaction, event);

    // Confirmer à l'utilisateur
    await interaction.reply({
        content: `❌ Compris! Vous ne participez pas à **${event.title}**.`,
        flags: MessageFlags.Ephemeral
    });
}

/**
 * Affiche les informations détaillées d'un événement
 */
async function handleEventInfo(interaction, event) {
    const eventDate = new Date(event.dateTime);
    const timestamp = Math.floor(eventDate.getTime() / 1000);
    const isUpcoming = eventDate > new Date();
    
    const embed = new EmbedBuilder()
        .setColor(isUpcoming ? 0x00ff00 : 0xff0000)
        .setTitle(`📅 ${event.title}`)
        .setDescription(event.description)
        .addFields(
            { 
                name: '📅 Date et heure', 
                value: `<t:${timestamp}:F>\n<t:${timestamp}:R>`, 
                inline: false 
            },
            { 
                name: '👥 Participants confirmés', 
                value: `${event.participants.attending.length}/${event.maxParticipants}`, 
                inline: true 
            },
            { 
                name: '❓ Peut-être', 
                value: `${event.participants.maybe.length}`, 
                inline: true 
            },
            { 
                name: '❌ Absents', 
                value: `${event.participants.notAttending.length}`, 
                inline: true 
            }
        )
        .setFooter({ 
            text: `ID: ${event.id} • Créé par ${interaction.client.users.cache.get(event.creatorId)?.tag || 'Utilisateur inconnu'}`,
            iconURL: interaction.client.user.displayAvatarURL()
        })
        .setTimestamp();

    // Afficher les participants si il y en a
    if (event.participants.attending.length > 0) {
        const attendingList = event.participants.attending
            .slice(0, 15) // Limiter pour éviter les embeds trop longs
            .map(userId => `<@${userId}>`)
            .join(', ');
        
        let attendingText = attendingList;
        if (event.participants.attending.length > 15) {
            attendingText += ` et ${event.participants.attending.length - 15} autre(s)...`;
        }
        
        embed.addFields({
            name: '✅ Liste des participants',
            value: attendingText,
            inline: false
        });
    }

    if (event.recurrence !== 'none') {
        embed.addFields({
            name: '🔄 Récurrence',
            value: getRecurrenceLabel(event.recurrence),
            inline: true
        });
    }

    // Ajouter des informations sur le statut de l'utilisateur
    const userId = interaction.user.id;
    let userStatus = 'Non répondu';
    
    if (event.participants.attending.includes(userId)) {
        userStatus = '✅ Vous participez';
    } else if (event.participants.maybe.includes(userId)) {
        userStatus = '❓ Peut-être';
    } else if (event.participants.notAttending.includes(userId)) {
        userStatus = '❌ Vous ne participez pas';
    }

    embed.addFields({
        name: '👤 Votre statut',
        value: userStatus,
        inline: true
    });

    await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
    });
}

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
 * Notifie le créateur de l'événement
 */
async function notifyEventCreator(interaction, event, type) {
    try {
        const creator = await interaction.client.users.fetch(event.creatorId);
        
        let message = '';
        switch (type) {
            case 'first_participant':
                message = `🎉 Bonne nouvelle! Le premier participant vient de s'inscrire à votre événement **${event.title}**!`;
                break;
        }
        
        if (message) {
            await creator.send(message);
        }
    } catch (error) {
        log.error('Erreur lors de la notification du créateur:', error);
    }
}

// Fonctions utilitaires

function loadEventsConfig() {
    return readEventsConfig();
}

function saveEventsConfig(config) {
    writeEventsConfig(config);
}

function removeUserFromAllLists(participants, userId) {
    // Retirer l'utilisateur de toutes les listes de participants
    participants.attending = participants.attending.filter(id => id !== userId);
    participants.maybe = participants.maybe.filter(id => id !== userId);
    participants.notAttending = participants.notAttending.filter(id => id !== userId);
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

    // Ajouter un indicateur si l'événement est passé
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

module.exports = {
    handleEventInteraction
};
