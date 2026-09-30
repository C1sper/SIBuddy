const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')

const devoirsService = require('../../services/devoirsService')
const categoriesService = require('../../services/categoriesService')
const { isFeatureEnabled } = require('../../services/guildConfig')

const { createLogger } = require('../../utils/logger');

const log = createLogger('commands');
const { IMPORTANCE_LABELS } = devoirsService

module.exports = {
  data: new SlashCommandBuilder()
    .setName('anciens-devoirs')
    .setDescription('Affiche les dates importantes déjà passées (archivées) de ce serveur.')
    .setContexts(['Guild']),
  emoji: '📜',

  async execute (interaction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: '❌ Cette commande doit être utilisée dans un serveur.',
        flags: MessageFlags.Ephemeral
      })
    }

    if (!isFeatureEnabled(interaction.guildId, 'homework')) {
      return interaction.reply({
        content: '❌ Le système de devoirs est désactivé sur ce serveur.',
        flags: MessageFlags.Ephemeral
      })
    }

    const guildId = interaction.guildId

    const moved = devoirsService.movePastDevoirsToArchive(guildId)
    if (moved > 0) {
      log.info(`Archivage : ${moved} devoir(s) déplacé(s) vers l’archive.`)
    }

    const archived = devoirsService.listArchived(guildId)

    if (archived.length === 0) {
      return interaction.reply({
        content: '📭 Aucun élément archivé pour ce serveur.',
        flags: MessageFlags.Ephemeral
      })
    }

    const max = 20
    const slice = archived.slice(0, max)

    const desc = slice
      .map((d, i) => {
        const category = devoirsService.getDevoirCategory(guildId, d)
        const impLabel = IMPORTANCE_LABELS[d.importance] || 'Important'
        const subject = d.matiere ? `**${d.matiere}** → ${d.titre}` : `**${d.titre}**`

        return (
          `**${i + 1}.** ${subject}\n` +
          `🗂️ ${categoriesService.formatCategory(category)} — 📅 ${devoirsService.formatEcheance(d)} — 📍 ${impLabel}\n` +
          (d.description ? `📝 ${d.description}\n` : '') +
          '​'
        )
      })
      .join('\n')

    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle('📜 Dates importantes passées (archivées)')
      .setDescription(desc)
      .setFooter({
        text:
          slice.length < archived.length
            ? `Affichage des ${slice.length} premiers éléments (sur ${archived.length})`
            : 'Tous les éléments archivés sont affichés'
      })
      .setTimestamp()

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
  }
}
