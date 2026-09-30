const { EmbedBuilder } = require('discord.js');
const { readEventsConfig, writeEventsConfig } = require('./eventsConfigStore');

const { createLogger } = require('../utils/logger');

const log = createLogger('reminderSystem');
/**
 * ===============================================
 * SYSTÈME DE RAPPELS AUTOMATIQUES - Événements
 * ===============================================
 * 
 * Fonction : Gère les rappels automatiques avant les événements
 * 
 * Fonctionnalités :
 * - Rappels programmés à différents intervalles (24h, 1h, 15min avant)
 * - Notifications personnalisées par utilisateur
 * - Gestion des fuseaux horaires
 * - Rappels pour événements récurrents
 * - Nettoyage automatique des rappels expirés
 * - Statistiques de participation en temps réel
 * 
 * Types de rappels :
 * - 24h avant : Rappel général avec détails complets
 * - 1h avant : Rappel urgent avec lien direct
 * - 15min avant : Rappel final "ça commence bientôt"
 * - Personnalisés : Rappels définis par l'utilisateur
 */

class ReminderSystem {
    constructor(client) {
        this.client = client;
        this.activeTimers = new Map(); // Stockage des timers actifs
        this.reminderIntervals = [
            { value: 24, unit: 'hours', label: '24h avant' },
            { value: 1, unit: 'hours', label: '1h avant' },
            { value: 15, unit: 'minutes', label: '15min avant' }
        ];
        
        // Démarrer le système de rappels
        this.initialize();
    }

    /**
     * Initialise le système de rappels
     */
    initialize() {
        log.info('Initialisation du système de rappels...');
        
        // Charger et programmer tous les rappels existants
        this.loadAndScheduleAllReminders();
        
        // Nettoyer les rappels expirés toutes les heures
        setInterval(() => {
            this.cleanupExpiredReminders();
        }, 60 * 60 * 1000); // 1 heure
        
        log.info('Système de rappels initialisé');
    }

    /**
     * Programme les rappels pour un événement
     */
    scheduleReminders(eventData) {
        const eventDate = new Date(eventData.dateTime);
        const now = new Date();

        // Vérifier que l'événement est dans le futur
        if (eventDate <= now) {
            return;
        }

        log.info(`Programmation des rappels pour: ${eventData.title}`);

        // Programmer chaque type de rappel
        this.reminderIntervals.forEach(interval => {
            const reminderTime = this.calculateReminderTime(eventDate, interval);
            
            // Ne programmer que si le rappel est dans le futur
            if (reminderTime > now) {
                this.scheduleReminder(eventData, interval, reminderTime);
            }
        });
    }

    /**
     * Programme un rappel spécifique
     */
    scheduleReminder(eventData, interval, reminderTime) {
        const reminderId = `${eventData.id}_${interval.value}_${interval.unit}`;
        const delay = reminderTime.getTime() - Date.now();

        // Annuler le timer existant s'il y en a un
        if (this.activeTimers.has(reminderId)) {
            clearTimeout(this.activeTimers.get(reminderId));
        }

        // Programmer le nouveau rappel
        const timer = setTimeout(async () => {
            await this.sendReminder(eventData, interval);
            this.activeTimers.delete(reminderId);
        }, delay);

        this.activeTimers.set(reminderId, timer);

        log.info(`⏰ Rappel programmé: ${eventData.title} - ${interval.label} (dans ${Math.round(delay / 1000 / 60)} minutes)`);
    }

    /**
     * Envoie un rappel aux participants
     */
    async sendReminder(eventData, interval) {
        try {
            // Recharger les données de l'événement pour avoir les participants à jour
            const eventsConfig = this.loadEventsConfig();
            const currentEvent = eventsConfig.events[eventData.guildId]?.[eventData.id];

            if (!currentEvent) {
                log.info(`Événement ${eventData.id} introuvable, rappel annulé`);
                return;
            }

            // Vérifier que l'événement n'a pas été supprimé ou modifié
            const eventDate = new Date(currentEvent.dateTime);
            const now = new Date();

            if (eventDate <= now) {
                log.info(`Événement ${currentEvent.title} déjà passé, rappel annulé`);
                return;
            }

            const participantsToRemind = [
                ...currentEvent.participants.attending,
                ...currentEvent.participants.maybe
            ];

            if (participantsToRemind.length === 0) {
                log.info(`Aucun participant à rappeler pour ${currentEvent.title}`);
                return;
            }

            // Créer l'embed de rappel
            const reminderEmbed = this.createReminderEmbed(currentEvent, interval);

            // Envoyer les rappels
            await this.sendRemindersToParticipants(participantsToRemind, reminderEmbed, currentEvent);

            // Envoyer aussi un rappel dans le canal de l'événement
            await this.sendChannelReminder(currentEvent, interval);

            log.info(`Rappel envoyé pour ${currentEvent.title} (${interval.label}) à ${participantsToRemind.length} participants`);

        } catch (error) {
            log.error('Erreur lors de l\'envoi du rappel:', error);
        }
    }

    /**
     * Crée l'embed de rappel
     */
    createReminderEmbed(eventData, interval) {
        const eventDate = new Date(eventData.dateTime);
        const timestamp = Math.floor(eventDate.getTime() / 1000);
        
        let color = 0x5865f2;
        let title = '📅 Rappel d\'événement';
        let description = '';

        // Personnaliser selon l'intervalle
        switch (interval.label) {
            case '24h avant':
                color = 0x3498db;
                title = '📅 Événement demain';
                description = `N'oubliez pas l'événement **${eventData.title}** qui aura lieu demain !`;
                break;
            case '1h avant':
                color = 0xf39c12;
                title = '⏰ Événement dans 1 heure';
                description = `L'événement **${eventData.title}** commence dans 1 heure !`;
                break;
            case '15min avant':
                color = 0xe74c3c;
                title = '🚨 Événement imminent';
                description = `L'événement **${eventData.title}** commence dans 15 minutes !`;
                break;
            default:
                description = `Rappel pour l'événement **${eventData.title}**`;
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description)
            .addFields(
                {
                    name: '📅 Date et heure',
                    value: `<t:${timestamp}:F>\n<t:${timestamp}:R>`,
                    inline: false
                },
                {
                    name: '📝 Description',
                    value: eventData.description.length > 200 
                        ? eventData.description.substring(0, 200) + '...'
                        : eventData.description,
                    inline: false
                },
                {
                    name: '👥 Participants confirmés',
                    value: `${eventData.participants.attending.length}/${eventData.maxParticipants}`,
                    inline: true
                },
                {
                    name: '❓ Peut-être',
                    value: `${eventData.participants.maybe.length}`,
                    inline: true
                }
            )
            .setFooter({
                text: `ID: ${eventData.id} • Rappel automatique`,
                iconURL: this.client.user.displayAvatarURL()
            })
            .setTimestamp();

        // Ajouter des instructions selon le timing
        if (interval.label === '15min avant') {
            embed.addFields({
                name: '🎯 Action requise',
                value: 'Préparez-vous, l\'événement commence bientôt !',
                inline: false
            });
        }

        return embed;
    }

    /**
     * Envoie les rappels aux participants
     */
    async sendRemindersToParticipants(participants, embed, eventData) {
        // Envoyer en chunks pour éviter le rate limiting
        const chunks = [];
        for (let i = 0; i < participants.length; i += 5) {
            chunks.push(participants.slice(i, i + 5));
        }

        for (const chunk of chunks) {
            const promises = chunk.map(async (userId) => {
                try {
                    const user = await this.client.users.fetch(userId);
                    await user.send({ embeds: [embed] });
                } catch (error) {
                    log.info(`Impossible d'envoyer le rappel à ${userId}:`, error.message);
                }
            });

            await Promise.all(promises);
            
            // Pause entre les chunks
            if (chunks.indexOf(chunk) < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    /**
     * Envoie un rappel dans le canal de l'événement
     */
    async sendChannelReminder(eventData, interval) {
        try {
            const channel = await this.client.channels.fetch(eventData.channelId);
            
            let message = '';
            switch (interval.label) {
                case '24h avant':
                    message = `📅 **Rappel:** L'événement **${eventData.title}** aura lieu demain !`;
                    break;
                case '1h avant':
                    message = `⏰ **Attention:** L'événement **${eventData.title}** commence dans 1 heure !`;
                    break;
                case '15min avant':
                    message = `🚨 **C'est parti !** L'événement **${eventData.title}** commence dans 15 minutes !`;
                    break;
            }

            if (message) {
                await channel.send({
                    content: message,
                    allowedMentions: { parse: [] } // Éviter les pings non désirés
                });
            }
        } catch (error) {
            log.error('Erreur lors de l\'envoi du rappel dans le canal:', error);
        }
    }

    /**
     * Calcule l'heure du rappel
     */
    calculateReminderTime(eventDate, interval) {
        const reminderTime = new Date(eventDate);
        
        switch (interval.unit) {
            case 'hours':
                reminderTime.setHours(reminderTime.getHours() - interval.value);
                break;
            case 'minutes':
                reminderTime.setMinutes(reminderTime.getMinutes() - interval.value);
                break;
            case 'days':
                reminderTime.setDate(reminderTime.getDate() - interval.value);
                break;
        }
        
        return reminderTime;
    }

    /**
     * Charge et programme tous les rappels existants
     */
    loadAndScheduleAllReminders() {
        const eventsConfig = this.loadEventsConfig();
        let scheduledCount = 0;

        Object.values(eventsConfig.events).forEach(guildEvents => {
            Object.values(guildEvents).forEach(event => {
                const eventDate = new Date(event.dateTime);
                const now = new Date();

                // Ne programmer que les événements futurs
                if (eventDate > now) {
                    this.scheduleReminders(event);
                    scheduledCount++;
                }
            });
        });

        log.info(`${scheduledCount} événements programmés pour les rappels`);
    }

    /**
     * Annule tous les rappels d'un événement
     */
    cancelReminders(eventId) {
        const timersToCancel = [];
        
        this.activeTimers.forEach((timer, reminderId) => {
            if (reminderId.startsWith(eventId)) {
                clearTimeout(timer);
                timersToCancel.push(reminderId);
            }
        });

        timersToCancel.forEach(reminderId => {
            this.activeTimers.delete(reminderId);
        });

        log.info(`🚫 ${timersToCancel.length} rappels annulés pour l'événement ${eventId}`);
    }

    /**
     * Nettoie les rappels expirés
     */
    cleanupExpiredReminders() {
        const eventsConfig = this.loadEventsConfig();
        const now = new Date();
        let cleanedCount = 0;

        // Parcourir tous les événements et supprimer ceux qui sont passés
        Object.keys(eventsConfig.events).forEach(guildId => {
            const guildEvents = eventsConfig.events[guildId];
            
            Object.keys(guildEvents).forEach(eventId => {
                const event = guildEvents[eventId];
                const eventDate = new Date(event.dateTime);
                
                // Supprimer les événements passés depuis plus de 24h
                if (eventDate < new Date(now.getTime() - 24 * 60 * 60 * 1000)) {
                    delete guildEvents[eventId];
                    this.cancelReminders(eventId);
                    cleanedCount++;
                }
            });
        });

        if (cleanedCount > 0) {
            this.saveEventsConfig(eventsConfig);
            log.info(`🧹 ${cleanedCount} événements expirés nettoyés`);
        }
    }

    /**
     * Met à jour les rappels d'un événement modifié
     */
    updateReminders(eventData) {
        // Annuler les anciens rappels
        this.cancelReminders(eventData.id);
        
        // Programmer les nouveaux rappels
        this.scheduleReminders(eventData);
        
        log.info(`Rappels mis à jour pour ${eventData.title}`);
    }

    // Fonctions utilitaires

    loadEventsConfig() {
        return readEventsConfig();
    }

    saveEventsConfig(config) {
        writeEventsConfig(config);
    }

    /**
     * Obtient les statistiques du système de rappels
     */
    getStats() {
        return {
            activeTimers: this.activeTimers.size,
            reminderIntervals: this.reminderIntervals.length
        };
    }
}

let instance = null;

/**
 * Démarre le système de rappels d'événements (/event-*) une seule fois.
 * Expose l'instance sur client.reminderSystem, utilisée par les commandes
 * event-create/edit/delete/stats et par utils/eventInteractions.js.
 */
function startEventReminders(client) {
  if (instance) return instance;
  instance = new ReminderSystem(client);
  client.reminderSystem = instance;
  return instance;
}

module.exports = ReminderSystem;
module.exports.startEventReminders = startEventReminders;
