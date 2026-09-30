const { readEventsConfig, writeEventsConfig } = require('./eventsConfigStore');
const { isFeatureEnabled } = require('./guildConfig');

const { createLogger } = require('../utils/logger');

const log = createLogger('recurringEvents');
/**
 * ===============================================
 * SYSTÈME D'ÉVÉNEMENTS RÉCURRENTS
 * ===============================================
 * 
 * Fonction : Gère la création automatique d'événements récurrents
 * 
 * Fonctionnalités :
 * - Événements hebdomadaires (même jour de la semaine)
 * - Événements mensuels (même date du mois)
 * - Création automatique des prochaines occurrences
 * - Gestion des conflits de dates
 * - Limitation du nombre d'occurrences futures
 * - Nettoyage automatique des anciennes occurrences
 * 
 * Types de récurrence :
 * - weekly : Chaque semaine au même jour et heure
 * - monthly : Chaque mois à la même date et heure
 * - none : Événement unique (pas de récurrence)
 */

class RecurringEventsManager {
    constructor(client) {
        this.client = client;
        this.maxFutureOccurrences = 4; // Nombre max d'occurrences futures à créer
        
        // Vérifier les événements récurrents toutes les heures
        setInterval(() => {
            this.processRecurringEvents();
        }, 60 * 60 * 1000); // 1 heure
        
        log.info('Gestionnaire d\'événements récurrents initialisé');
    }

    /**
     * Traite tous les événements récurrents
     */
    async processRecurringEvents() {
        try {
            const eventsConfig = this.loadEventsConfig();
            let processedCount = 0;

            // Parcourir tous les serveurs
            for (const guildId in eventsConfig.events) {
                // Ne pas générer de nouvelles occurrences si la fonctionnalité est désactivée
                // pour cette guild (les occurrences déjà créées restent intactes).
                if (!isFeatureEnabled(guildId, 'recurringEvents')) continue;

                const guildEvents = eventsConfig.events[guildId];

                // Parcourir tous les événements du serveur
                for (const eventId in guildEvents) {
                    const event = guildEvents[eventId];
                    
                    // Traiter seulement les événements récurrents
                    if (event.recurrence && event.recurrence !== 'none') {
                        const created = await this.createNextOccurrences(event, eventsConfig);
                        if (created > 0) {
                            processedCount += created;
                        }
                    }
                }
            }

            if (processedCount > 0) {
                this.saveEventsConfig(eventsConfig);
                log.info(`${processedCount} nouvelles occurrences d'événements récurrents créées`);
            }

        } catch (error) {
            log.error('Erreur lors du traitement des événements récurrents:', error);
        }
    }

    /**
     * Crée les prochaines occurrences d'un événement récurrent
     */
    async createNextOccurrences(baseEvent, eventsConfig) {
        const now = new Date();
        const baseEventDate = new Date(baseEvent.dateTime);
        let createdCount = 0;

        // Si l'événement de base est dans le futur, pas besoin de créer d'occurrences
        if (baseEventDate > now) {
            return 0;
        }

        // Calculer les prochaines dates selon le type de récurrence
        const nextDates = this.calculateNextDates(baseEvent, now);
        
        for (const nextDate of nextDates) {
            // Vérifier qu'il n'existe pas déjà un événement à cette date
            if (!this.eventExistsAtDate(baseEvent, nextDate, eventsConfig)) {
                const newEvent = await this.createRecurringOccurrence(baseEvent, nextDate, eventsConfig);
                if (newEvent) {
                    createdCount++;
                }
            }
        }

        return createdCount;
    }

    /**
     * Calcule les prochaines dates selon le type de récurrence
     */
    calculateNextDates(baseEvent, fromDate) {
        const dates = [];
        const baseDate = new Date(baseEvent.dateTime);
        let currentDate = new Date(fromDate);

        // Ajuster la date de départ selon le type de récurrence
        switch (baseEvent.recurrence) {
            case 'weekly':
                // Trouver le prochain même jour de la semaine
                const targetDayOfWeek = baseDate.getDay();
                const daysUntilTarget = (targetDayOfWeek - currentDate.getDay() + 7) % 7;
                if (daysUntilTarget === 0 && currentDate > baseDate) {
                    currentDate.setDate(currentDate.getDate() + 7);
                } else {
                    currentDate.setDate(currentDate.getDate() + daysUntilTarget);
                }
                
                // Ajuster l'heure
                currentDate.setHours(baseDate.getHours(), baseDate.getMinutes(), 0, 0);
                
                // Créer les prochaines occurrences hebdomadaires
                for (let i = 0; i < this.maxFutureOccurrences; i++) {
                    dates.push(new Date(currentDate));
                    currentDate.setDate(currentDate.getDate() + 7);
                }
                break;

            case 'monthly':
                // Trouver le prochain même jour du mois
                const targetDay = baseDate.getDate();
                
                // Commencer au mois suivant si on est déjà passé ce jour-ci
                if (currentDate.getDate() > targetDay || 
                    (currentDate.getDate() === targetDay && currentDate > baseDate)) {
                    currentDate.setMonth(currentDate.getMonth() + 1);
                }
                
                // Créer les prochaines occurrences mensuelles
                for (let i = 0; i < this.maxFutureOccurrences; i++) {
                    const nextDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), targetDay, 
                                            baseDate.getHours(), baseDate.getMinutes(), 0, 0);
                    
                    // Gérer les mois qui n'ont pas assez de jours (ex: 31 février -> 28/29 février)
                    if (nextDate.getDate() !== targetDay) {
                        nextDate.setDate(0); // Dernier jour du mois précédent
                    }
                    
                    dates.push(nextDate);
                    currentDate.setMonth(currentDate.getMonth() + 1);
                }
                break;
        }

        return dates.filter(date => date > fromDate); // Seulement les dates futures
    }

    /**
     * Vérifie si un événement existe déjà à une date donnée
     */
    eventExistsAtDate(baseEvent, targetDate, eventsConfig) {
        const guildEvents = eventsConfig.events[baseEvent.guildId] || {};
        
        return Object.values(guildEvents).some(event => {
            // Vérifier si c'est le même événement de base (même titre et créateur)
            if (event.title === baseEvent.title && 
                event.creatorId === baseEvent.creatorId &&
                event.channelId === baseEvent.channelId) {
                
                const eventDate = new Date(event.dateTime);
                const targetDateStr = targetDate.toISOString().split('T')[0];
                const eventDateStr = eventDate.toISOString().split('T')[0];
                
                return targetDateStr === eventDateStr;
            }
            return false;
        });
    }

    /**
     * Crée une nouvelle occurrence d'un événement récurrent
     */
    async createRecurringOccurrence(baseEvent, nextDate, eventsConfig) {
        try {
            // Générer un nouvel ID pour cette occurrence
            const newEventId = this.generateEventId(baseEvent.guildId);
            
            // Créer le nouvel événement basé sur l'original
            const newEvent = {
                ...baseEvent,
                id: newEventId,
                dateTime: nextDate.toISOString(),
                participants: {
                    attending: [],
                    maybe: [],
                    notAttending: []
                },
                createdAt: new Date().toISOString(),
                messageId: null,
                discordEventId: null,
                // Marquer comme occurrence récurrente
                isRecurringOccurrence: true,
                baseEventId: baseEvent.id
            };

            // Ajouter à la configuration
            if (!eventsConfig.events[baseEvent.guildId]) {
                eventsConfig.events[baseEvent.guildId] = {};
            }
            eventsConfig.events[baseEvent.guildId][newEventId] = newEvent;

            // Créer le message d'événement
            await this.createEventMessage(newEvent);

            // Programmer les rappels
            if (this.client.reminderSystem) {
                this.client.reminderSystem.scheduleReminders(newEvent);
            }

            log.info(`Nouvelle occurrence créée: ${newEvent.title} le ${nextDate.toLocaleDateString('fr-FR')}`);
            
            return newEvent;

        } catch (error) {
            log.error('Erreur lors de la création d\'une occurrence récurrente:', error);
            return null;
        }
    }

    /**
     * Crée le message Discord pour l'événement
     */
    async createEventMessage(eventData) {
        try {
            const channel = await this.client.channels.fetch(eventData.channelId);
            
            const eventEmbed = this.createEventEmbed(eventData);
            const rsvpButtons = this.createRSVPButtons(eventData.id);

            const message = await channel.send({
                embeds: [eventEmbed],
                components: [rsvpButtons]
            });

            // Mettre à jour l'ID du message
            eventData.messageId = message.id;

            // Créer l'événement Discord natif
            try {
                const discordEvent = await channel.guild.scheduledEvents.create({
                    name: eventData.title,
                    description: eventData.description + '\n\n🔄 Événement récurrent',
                    scheduledStartTime: new Date(eventData.dateTime),
                    privacyLevel: 2,
                    entityType: 3,
                    entityMetadata: {
                        location: `Canal: #${channel.name}`
                    }
                });
                
                eventData.discordEventId = discordEvent.id;
            } catch (error) {
                log.info('Impossible de créer l\'événement Discord natif récurrent:', error.message);
            }

        } catch (error) {
            log.error('Erreur lors de la création du message d\'événement récurrent:', error);
        }
    }

    /**
     * Nettoie les anciennes occurrences d'événements récurrents
     */
    cleanupOldRecurrences() {
        const eventsConfig = this.loadEventsConfig();
        const now = new Date();
        const cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 jours
        let cleanedCount = 0;

        Object.keys(eventsConfig.events).forEach(guildId => {
            const guildEvents = eventsConfig.events[guildId];
            
            Object.keys(guildEvents).forEach(eventId => {
                const event = guildEvents[eventId];
                
                // Supprimer les occurrences récurrentes anciennes
                if (event.isRecurringOccurrence) {
                    const eventDate = new Date(event.dateTime);
                    
                    if (eventDate < cutoffDate) {
                        delete guildEvents[eventId];
                        cleanedCount++;
                    }
                }
            });
        });

        if (cleanedCount > 0) {
            this.saveEventsConfig(eventsConfig);
            log.info(`🧹 ${cleanedCount} anciennes occurrences récurrentes supprimées`);
        }
    }

    // Fonctions utilitaires (réutilisées des autres fichiers)

    generateEventId(guildId) {
        return `${guildId}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    createEventEmbed(eventData) {
        const { EmbedBuilder } = require('discord.js');
        
        const eventDate = new Date(eventData.dateTime);
        const timestamp = Math.floor(eventDate.getTime() / 1000);
        const isUpcoming = eventDate > new Date();
        
        const embed = new EmbedBuilder()
            .setColor(isUpcoming ? 0x5865f2 : 0x747f8d)
            .setTitle(`📅 ${eventData.title}`)
            .setDescription(eventData.description + (eventData.isRecurringOccurrence ? '\n\n🔄 *Événement récurrent*' : ''))
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
                text: `ID: ${eventData.id} • Créé automatiquement`,
                iconURL: this.client.user.displayAvatarURL()
            })
            .setTimestamp();

        if (eventData.recurrence !== 'none') {
            embed.addFields({
                name: '🔄 Récurrence',
                value: this.getRecurrenceLabel(eventData.recurrence),
                inline: true
            });
        }

        return embed;
    }

    createRSVPButtons(eventId) {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        
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

    getRecurrenceLabel(recurrence) {
        switch (recurrence) {
            case 'weekly': return '🔄 Hebdomadaire';
            case 'monthly': return '🔄 Mensuelle';
            default: return '➡️ Unique';
        }
    }

    loadEventsConfig() {
        return readEventsConfig();
    }

    saveEventsConfig(config) {
        writeEventsConfig(config);
    }
}

let instance = null;

/**
 * Démarre le gestionnaire d'événements récurrents une seule fois.
 */
function startRecurringEvents(client) {
  if (instance) return instance;
  instance = new RecurringEventsManager(client);
  client.recurringEventsManager = instance;
  return instance;
}

module.exports = RecurringEventsManager;
module.exports.startRecurringEvents = startRecurringEvents;
