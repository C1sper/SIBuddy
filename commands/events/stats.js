const { 
    SlashCommandBuilder, 
    EmbedBuilder 
} = require('discord.js');
const { readEventsConfig, writeEventsConfig } = require('../../services/eventsConfigStore');

const { createLogger } = require('../../utils/logger');

const log = createLogger('commands');
/**
 * ==========================================
 * COMMANDE EVENT-STATS - Statistiques des événements
 * ==========================================
 * 
 * Fonction : Affiche les statistiques détaillées du système d'événements
 * 
 * Fonctionnalités :
 * - Statistiques globales du serveur
 * - Événements par statut (à venir, passés)
 * - Taux de participation moyen
 * - Événements les plus populaires
 * - Créateurs les plus actifs
 * - Statistiques du système de rappels
 * - Événements récurrents actifs
 * 
 * Usage : /event-stats
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('event-stats')
        .setDescription('Affiche les statistiques du système d\'événements'),
    emoji: '📊',

    async execute(interaction) {
        await interaction.deferReply();

        try {
            // Charger la configuration des événements
            const eventsConfig = loadEventsConfig();
            const guildEvents = eventsConfig.events[interaction.guildId] || {};
            const events = Object.values(guildEvents);

            if (events.length === 0) {
                return await interaction.editReply({
                    embeds: [createNoStatsEmbed()]
                });
            }

            // Calculer les statistiques
            const stats = calculateEventStats(events);
            
            // Obtenir les statistiques des systèmes
            const reminderStats = interaction.client.reminderSystem?.getStats() || { activeTimers: 0 };
            
            // Créer l'embed des statistiques
            const statsEmbed = createStatsEmbed(stats, reminderStats, interaction);

            await interaction.editReply({ embeds: [statsEmbed] });

        } catch (error) {
            log.error('Erreur lors du calcul des statistiques:', error);
            await interaction.editReply({
                content: '❌ Une erreur est survenue lors du calcul des statistiques.'
            });
        }
    }
};

/**
 * Calcule toutes les statistiques des événements
 */
function calculateEventStats(events) {
    const now = new Date();
    const stats = {
        total: events.length,
        upcoming: 0,
        past: 0,
        recurring: 0,
        totalParticipants: 0,
        totalMaybes: 0,
        totalDeclined: 0,
        averageParticipation: 0,
        mostPopular: null,
        creatorStats: {},
        participationByMonth: {},
        recurringTypes: { weekly: 0, monthly: 0 }
    };

    events.forEach(event => {
        const eventDate = new Date(event.dateTime);
        const isUpcoming = eventDate > now;
        
        // Compter par statut
        if (isUpcoming) {
            stats.upcoming++;
        } else {
            stats.past++;
        }

        // Compter les récurrents
        if (event.recurrence && event.recurrence !== 'none') {
            stats.recurring++;
            stats.recurringTypes[event.recurrence]++;
        }

        // Compter les participants
        const attending = event.participants.attending.length;
        const maybe = event.participants.maybe.length;
        const declined = event.participants.notAttending.length;
        
        stats.totalParticipants += attending;
        stats.totalMaybes += maybe;
        stats.totalDeclined += declined;

        // Trouver l'événement le plus populaire
        if (!stats.mostPopular || attending > stats.mostPopular.participants) {
            stats.mostPopular = {
                title: event.title,
                participants: attending,
                date: eventDate
            };
        }

        // Statistiques par créateur
        const creatorId = event.creatorId;
        if (!stats.creatorStats[creatorId]) {
            stats.creatorStats[creatorId] = {
                count: 0,
                totalParticipants: 0
            };
        }
        stats.creatorStats[creatorId].count++;
        stats.creatorStats[creatorId].totalParticipants += attending;

        // Participation par mois (pour les événements passés)
        if (!isUpcoming) {
            const monthKey = `${eventDate.getFullYear()}-${eventDate.getMonth() + 1}`;
            if (!stats.participationByMonth[monthKey]) {
                stats.participationByMonth[monthKey] = { events: 0, participants: 0 };
            }
            stats.participationByMonth[monthKey].events++;
            stats.participationByMonth[monthKey].participants += attending;
        }
    });

    // Calculer la participation moyenne
    if (stats.past > 0) {
        stats.averageParticipation = Math.round(stats.totalParticipants / stats.past * 100) / 100;
    }

    return stats;
}

/**
 * Crée l'embed des statistiques
 */
function createStatsEmbed(stats, reminderStats, interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📊 Statistiques des événements')
        .setDescription(`Voici un aperçu de l'activité événementielle sur ce serveur.`)
        .setThumbnail(interaction.guild.iconURL())
        .setTimestamp();

    // Statistiques générales
    embed.addFields(
        {
            name: '📈 Vue d\'ensemble',
            value: `**Total d'événements:** ${stats.total}\n` +
                   `**À venir:** ${stats.upcoming}\n` +
                   `**Passés:** ${stats.past}\n` +
                   `**Récurrents:** ${stats.recurring}`,
            inline: true
        },
        {
            name: '👥 Participation',
            value: `**Total participants:** ${stats.totalParticipants}\n` +
                   `**"Peut-être":** ${stats.totalMaybes}\n` +
                   `**Absents:** ${stats.totalDeclined}\n` +
                   `**Moyenne/événement:** ${stats.averageParticipation}`,
            inline: true
        }
    );

    // Événement le plus populaire
    if (stats.mostPopular) {
        const popularDate = stats.mostPopular.date.toLocaleDateString('fr-FR');
        embed.addFields({
            name: '🏆 Événement le plus populaire',
            value: `**${stats.mostPopular.title}**\n` +
                   `${stats.mostPopular.participants} participants\n` +
                   `Date: ${popularDate}`,
            inline: false
        });
    }

    // Top créateurs
    const topCreators = Object.entries(stats.creatorStats)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 3);

    if (topCreators.length > 0) {
        const creatorsText = topCreators.map(([userId, data], index) => {
            const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
            return `${medal} <@${userId}> - ${data.count} événement(s)`;
        }).join('\n');

        embed.addFields({
            name: '👑 Créateurs les plus actifs',
            value: creatorsText,
            inline: false
        });
    }

    // Statistiques des récurrents
    if (stats.recurring > 0) {
        embed.addFields({
            name: '🔄 Événements récurrents',
            value: `**Hebdomadaires:** ${stats.recurringTypes.weekly || 0}\n` +
                   `**Mensuels:** ${stats.recurringTypes.monthly || 0}`,
            inline: true
        });
    }

    // Statistiques du système
    embed.addFields({
        name: '⚙️ Système',
        value: `**Rappels actifs:** ${reminderStats.activeTimers}\n` +
               `**Dernière mise à jour:** <t:${Math.floor(Date.now() / 1000)}:R>`,
        inline: true
    });

    // Tendance mensuelle (derniers 3 mois)
    const recentMonths = Object.entries(stats.participationByMonth)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 3);

    if (recentMonths.length > 0) {
        const monthlyText = recentMonths.map(([month, data]) => {
            const [year, monthNum] = month.split('-');
            const monthName = new Date(year, monthNum - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
            return `**${monthName}:** ${data.events} événement(s), ${data.participants} participants`;
        }).join('\n');

        embed.addFields({
            name: '📅 Activité récente',
            value: monthlyText,
            inline: false
        });
    }

    embed.setFooter({
        text: `Serveur: ${interaction.guild.name}`,
        iconURL: interaction.client.user.displayAvatarURL()
    });

    return embed;
}

/**
 * Crée l'embed quand il n'y a pas de statistiques
 */
function createNoStatsEmbed() {
    return new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle('📊 Statistiques des événements')
        .setDescription('Aucun événement trouvé sur ce serveur.\n\nUtilisez `/event-create` pour créer votre premier événement !')
        .setTimestamp();
}

// Fonctions utilitaires

function loadEventsConfig() {
    return readEventsConfig();
}
