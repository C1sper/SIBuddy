const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const Parser = require('rss-parser');
const { readRssConfig, writeRssConfig } = require('../../services/rssConfigStore');

const { createLogger } = require('../../utils/logger');

const log = createLogger('commands');
module.exports = {
    data: new SlashCommandBuilder()
        .setName('rss-setup')
        .setDescription('Configure un flux RSS pour un channel spécifique')
        .addStringOption(option =>
            option
                .setName('url')
                .setDescription('URL du flux RSS à suivre')
                .setRequired(true)
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel où publier les nouvelles du flux RSS')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption(option =>
            option
                .setName('nom')
                .setDescription('Nom personnalisé pour ce flux RSS (optionnel)')
                .setRequired(false)
        ),
    emoji: '⚙️',

    async execute(interaction) {
        // Vérifier que l'utilisateur a les permissions d'administrateur
        if (!interaction.member.permissions.has('Administrator')) {
            return await interaction.reply({
                content: 'Vous devez être administrateur pour configurer les flux RSS.',
                flags: MessageFlags.Ephemeral
            });
        }

        const url = interaction.options.getString('url');
        const channel = interaction.options.getChannel('channel');
        const customName = interaction.options.getString('nom');

        await interaction.deferReply();

        try {
            // Vérifier que l'URL RSS est valide
            const parser = new Parser();
            const feed = await parser.parseURL(url);
            
            // Charger la configuration existante ou créer une nouvelle
            let rssConfig = {};
            rssConfig = readRssConfig();

            // Initialiser la configuration du serveur si elle n'existe pas
            if (!rssConfig[interaction.guildId]) {
                rssConfig[interaction.guildId] = {};
            }

            // Créer un identifiant unique pour ce flux
            const feedId = `${interaction.guildId}_${channel.id}_${Date.now()}`;

            // Ajouter la nouvelle configuration
            rssConfig[interaction.guildId][feedId] = {
                url: url,
                channelId: channel.id,
                channelName: channel.name,
                feedTitle: feed.title || 'Flux RSS',
                customName: customName || feed.title || 'Flux RSS',
                lastCheck: null,
                createdBy: interaction.user.id,
                createdAt: new Date().toISOString()
            };

            // Sauvegarder la configuration
            writeRssConfig(rssConfig);

            // Répondre avec succès
            await interaction.editReply({
                content: `**Flux RSS configuré avec succès !**\n` +
                        `**Flux:** ${customName || feed.title}\n` +
                        `**URL:** ${url}\n` +
                        `**Channel:** ${channel}\n` +
                        `**Articles disponibles:** ${feed.items?.length || 0}\n\n` +
                        `Le bot vérifiera automatiquement ce flux et publiera les nouveaux articles dans le channel spécifié.`
            });

            log.info(`RSS configuré: ${customName || feed.title} -> #${channel.name} par ${interaction.user.tag}`);

        } catch (error) {
            log.error('Erreur lors de la configuration RSS:', error);

            let errorMessage = 'Erreur lors de la configuration du flux RSS.';
            
            if (error.message.includes('Invalid RSS')) {
                errorMessage = 'L\'URL fournie ne semble pas être un flux RSS valide.';
            } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
                errorMessage = 'Impossible d\'accéder à l\'URL fournie. Vérifiez que l\'URL est correcte et accessible.';
            }

            await interaction.editReply({
                content: errorMessage + '\n\n' +
                        '**Conseils:**\n' +
                        '• Vérifiez que l\'URL est correcte\n' +
                        '• Assurez-vous que c\'est bien un flux RSS/Atom\n' +
                        '• Testez l\'URL dans votre navigateur'
            });
        }
    },
};