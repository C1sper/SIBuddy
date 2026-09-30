const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

/**
 * ===============================================
 * COMMANDE HELP - Système d'aide automatique
 * ===============================================
 * 
 * Fonction : Génère automatiquement la liste de toutes les commandes disponibles
 * 
 * Fonctionnement :
 * 1. Récupère toutes les commandes depuis client.commands (Collection Discord.js)
 * 2. Parcourt chaque commande pour extraire ses métadonnées
 * 3. Utilise l'emoji personnalisé ou un emoji par défaut (🔧)
 * 4. Récupère la description depuis command.data.description
 * 5. Trie les commandes par ordre alphabétique
 * 6. Génère un embed avec toutes les informations
 * 
 * Avantages du système :
 * - 100% automatique : aucune maintenance manuelle requise
 * - Scalable : nouvelles commandes apparaissent automatiquement
 * - Cohérent : utilise les vraies descriptions des commandes
 * - Organisé : tri alphabétique et compteur de commandes
 * 
 * Structure requise pour les commandes :
 * - command.data.name : nom de la commande
 * - command.data.description : description officielle
 * - command.emoji (optionnel) : emoji d'affichage
 * 
 * Usage : /help (aucun paramètre requis)
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Affiche la liste des commandes disponibles'),
    // Métadonnées pour la commande help
    emoji: '❓',
    async execute(interaction) {
        // Récupérer toutes les commandes disponibles
        const commands = interaction.client.commands;

        // Une ligne par commande, triée par nom. On utilise la description
        // de l'embed (limite 4096 caractères) plutôt que des fields (limite
        // 25 fields max) : le nombre de commandes n'est pas borné à 25.
        const lines = commands
            .map(command => `${command.emoji || '🔧'} **/${command.data.name}** — ${command.data.description}`)
            .sort((a, b) => a.localeCompare(b));

        // Découpe en plusieurs embeds si jamais la liste devient trop longue,
        // pour ne jamais tronquer silencieusement des commandes.
        const DESCRIPTION_MAX = 4096;
        const chunks = [];
        let current = '';
        for (const line of lines) {
            const candidate = current ? `${current}\n${line}` : line;
            if (candidate.length > DESCRIPTION_MAX) {
                chunks.push(current);
                current = line;
            } else {
                current = candidate;
            }
        }
        if (current) chunks.push(current);

        const embeds = chunks.map((description, index) =>
            new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(index === 0 ? '🤖 Aide - 4SIB Bot' : `🤖 Aide - 4SIB Bot (suite ${index + 1})`)
                .setDescription(index === 0 ? `Voici la liste des **${lines.length}** commandes disponibles :\n\n${description}` : description)
                .setFooter({
                    text: 'Bot Discord 4SIB',
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp()
        );

        await interaction.reply({ embeds: embeds.slice(0, 10) });
    },
};
