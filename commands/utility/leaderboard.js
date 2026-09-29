const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const fs = require('fs')
const path = require('path')

module.exports = {
    data: new SlashCommandBuilder().setName('leaderboard').setDescription('top des joueurs (top 10)'),
    async execute(interaction) {
        const filePath = path.resolve(__dirname, '..', '..', 'data', 'points.json')
        let data = {}

        try {
            const raw = fs.readFileSync(filePath, 'utf8')
            data = raw ? JSON.parse(raw) : {}
        } catch (e) {
            console.log('Impossible de lire points.json:', e.message)
            data = {}
        }

        console.log('DEBUG points.json content:', data)

        let entries = []
        if (Array.isArray(data)) {
            entries = data.map(item => [String(item.id), Number(item.pts || 0)])
        } else if (data && typeof data === 'object') {
            entries = Object.entries(data).map(([id, pts]) => [String(id), Number(pts || 0)])
        }

        entries = entries
            .filter(([, pts]) => !Number.isNaN(pts))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)

        const lines = entries.length
            ? entries.map(([id, pts], i) => `${i + 1}. <@${id}> — ${pts} pts`).join('\n')
            : 'Aucun joueur enregistré.'

        const embed = new EmbedBuilder()
            .setTitle('Leaderboard')
            .setDescription(lines)
            .setColor('#00AAFF')

        await interaction.reply({ embeds: [embed] })
    }
}
