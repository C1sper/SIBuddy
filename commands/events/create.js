const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ChannelType, MessageFlags } = require('discord.js');
const { readEventsConfig, writeEventsConfig } = require('../../services/eventsConfigStore');

const { createLogger } = require('../../utils/logger');

const log = createLogger('commands');
/**
 * =============================================
 * COMMANDE EVENT-CREATE - Création d'événements
 * =============================================
 * 
 * Fonction : Crée un nouvel événement avec système RSVP
 * 
 * Fonctionnalités :
 * - Création d'événements avec titre, description, date/heure
 * - Système RSVP avec boutons interactifs (Participer/Absent/Peut-être)
 * - Limite de participants configurable
 * - Rappels automatiques avant l'événement
 * - Intégration avec les événements Discord natifs
 * - Support des événements récurrents
 * 
 * Paramètres :
 * - titre : Nom de l'événement (requis)
 * - description : Description détaillée (requis)
 * - date : Date au format DD/MM/YYYY (requis)
 * - heure : Heure au format HH:MM (requis)
 * - limite : Nombre max de participants (optionnel, défaut: 50)
 * - canal : Canal pour l'annonce (optionnel, défaut: canal actuel)
 * - recurrence : Type de récurrence (optionnel: aucune, hebdomadaire, mensuelle)
 * 
 * Usage : /event-create titre:"Réunion équipe" description:"..." date:"25/10/2025" heure:"14:30"
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('event-create')
        .setDescription('Crée un nouvel événement avec système RSVP')
        .addStringOption(option =>
            option
                .setName('titre')
                .setDescription('Titre de l\'événement')
                .setRequired(true)
                .setMaxLength(100)
        )
        .addStringOption(option =>
            option
                .setName('description')
                .setDescription('Description de l\'événement')
                .setRequired(true)
                .setMaxLength(1000)
        )
        .addStringOption(option =>
            option
                .setName('date')
                .setDescription('Date de l\'événement (format: DD/MM/YYYY)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('heure')
                .setDescription('Heure de l\'événement (format: HH:MM)')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('limite')
                .setDescription('Nombre maximum de participants (défaut: 50)')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(false)
        )
        .addChannelOption(option =>
            option
                .setName('canal')
                .setDescription('Canal pour publier l\'événement (défaut: canal actuel)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('recurrence')
                .setDescription('Type de récurrence de l\'événement')
                .addChoices(
                    { name: 'Aucune', value: 'none' },
                    { name: 'Hebdomadaire', value: 'weekly' },
                    { name: 'Mensuelle', value: 'monthly' }
                )
                .setRequired(false)
        ),
    emoji: '📅',

    async execute(interaction) {
        // Vérifier les permissions (seuls les modérateurs peuvent créer des événements)
        if (!interaction.member.permissions.has('ManageEvents') && !interaction.member.permissions.has('Administrator')) {
            return await interaction.reply({
                content: '❌ Vous devez avoir la permission "Gérer les événements" pour créer un événement.',
                flags: MessageFlags.Ephemeral
            });
        }

        const titre = interaction.options.getString('titre');
        const description = interaction.options.getString('description');
        const dateStr = interaction.options.getString('date');
        const heureStr = interaction.options.getString('heure');
        const limite = interaction.options.getInteger('limite') || 50;
        const canal = interaction.options.getChannel('canal') || interaction.channel;
        const recurrence = interaction.options.getString('recurrence') || 'none';

        await interaction.deferReply();

        try {
            // Valider et parser la date/heure
            const eventDateTime = parseDateTime(dateStr, heureStr);
            if (!eventDateTime) {
                return await interaction.editReply({
                    content: '❌ Format de date/heure invalide. Utilisez DD/MM/YYYY pour la date et HH:MM pour l\'heure.'
                });
            }

            // Vérifier que la date est dans le futur
            if (eventDateTime <= new Date()) {
                return await interaction.editReply({
                    content: '❌ La date de l\'événement doit être dans le futur.'
                });
            }

            // Charger la configuration existante
            let eventsConfig = loadEventsConfig();

            // Générer un ID unique pour l'événement
            const eventId = generateEventId(interaction.guildId);

            // Créer l'objet événement
            const eventData = {
                id: eventId,
                guildId: interaction.guildId,
                channelId: canal.id,
                creatorId: interaction.user.id,
                title: titre,
                description: description,
                dateTime: eventDateTime.toISOString(),
                maxParticipants: limite,
                recurrence: recurrence,
                participants: {
                    attending: [],
                    maybe: [],
                    notAttending: []
                },
                createdAt: new Date().toISOString(),
                messageId: null, // Sera défini après l'envoi du message
                discordEventId: null // Pour l'intégration Discord native
            };

            // Initialiser la configuration du serveur si nécessaire
            if (!eventsConfig.events[interaction.guildId]) {
                eventsConfig.events[interaction.guildId] = {};
            }

            // Vérifier la limite d'événements par serveur
            const guildEvents = Object.keys(eventsConfig.events[interaction.guildId]).length;
            if (guildEvents >= eventsConfig.settings.maxEventsPerGuild) {
                return await interaction.editReply({
                    content: `❌ Limite d'événements atteinte (${eventsConfig.settings.maxEventsPerGuild} max). Supprimez des événements anciens d'abord.`
                });
            }

            // Créer l'embed de l'événement
            const eventEmbed = createEventEmbed(eventData, interaction.client);

            // Créer les boutons RSVP
            const rsvpButtons = createRSVPButtons(eventId);

            // Envoyer le message dans le canal spécifié
            const eventMessage = await canal.send({
                embeds: [eventEmbed],
                components: [rsvpButtons]
            });

            // Mettre à jour l'ID du message dans les données
            eventData.messageId = eventMessage.id;

            // Sauvegarder l'événement
            eventsConfig.events[interaction.guildId][eventId] = eventData;
            saveEventsConfig(eventsConfig);

            // Programmer les rappels automatiques
            if (interaction.client.reminderSystem) {
                interaction.client.reminderSystem.scheduleReminders(eventData);
            }

            // Créer un événement Discord natif si possible
            try {
                const discordEvent = await interaction.guild.scheduledEvents.create({
                    name: titre,
                    description: description,
                    scheduledStartTime: eventDateTime,
                    privacyLevel: 2, // GUILD_ONLY
                    entityType: 3, // EXTERNAL
                    entityMetadata: {
                        location: `Canal: #${canal.name}`
                    }
                });
                
                eventData.discordEventId = discordEvent.id;
                eventsConfig.events[interaction.guildId][eventId] = eventData;
                saveEventsConfig(eventsConfig);
            } catch (error) {
                log.info('Impossible de créer l\'événement Discord natif:', error.message);
            }

            // Confirmation de création
            const confirmEmbed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('✅ Événement créé avec succès!')
                .setDescription(`**${titre}** a été créé dans ${canal}`)
                .addFields(
                    { name: '📅 Date', value: `<t:${Math.floor(eventDateTime.getTime() / 1000)}:F>`, inline: true },
                    { name: '👥 Limite', value: `${limite} participants`, inline: true },
                    { name: '🔄 Récurrence', value: getRecurrenceLabel(recurrence), inline: true }
                )
                .setFooter({ 
                    text: `ID: ${eventId}`, 
                    iconURL: interaction.client.user.displayAvatarURL() 
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [confirmEmbed] });

        } catch (error) {
            log.error('Erreur lors de la création de l\'événement:', error);
            await interaction.editReply({
                content: '❌ Une erreur est survenue lors de la création de l\'événement.'
            });
        }
    }
};

// Fonctions utilitaires

function parseDateTime(dateStr, timeStr) {
    try {
        const [day, month, year] = dateStr.split('/').map(Number);
        const [hours, minutes] = timeStr.split(':').map(Number);
        
        if (!day || !month || !year || hours === undefined || minutes === undefined) {
            return null;
        }
        
        const date = new Date(year, month - 1, day, hours, minutes);
        
        // Vérifier que la date est valide
        if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getFullYear() !== year) {
            return null;
        }
        
        return date;
    } catch (error) {
        return null;
    }
}

function generateEventId(guildId) {
    return `${guildId}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
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
    
    const totalParticipants = eventData.participants.attending.length + 
                             eventData.participants.maybe.length + 
                             eventData.participants.notAttending.length;

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
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

// Cette fonction n'est plus nécessaire car gérée par le ReminderSystem

function getRecurrenceLabel(recurrence) {
    switch (recurrence) {
        case 'weekly': return '🔄 Hebdomadaire';
        case 'monthly': return '🔄 Mensuelle';
        default: return '➡️ Unique';
    }
}
