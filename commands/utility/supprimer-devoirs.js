const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js')

const devoirsService = require('../../services/devoirsService')
const categoriesService = require('../../services/categoriesService')
const { isFeatureEnabled } = require('../../services/guildConfig')
const { respondWithDevoirs } = require('../../utils/devoirAutocomplete')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('supprimer-devoir')
    .setDescription('Supprime une date importante via une liste.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(['Guild'])
    .addStringOption(option =>
      option
        .setName('devoir')
        .setDescription('Choisis l’élément à supprimer')
        .setRequired(true)
        .setAutocomplete(true)
    ),
  emoji: '❌',

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

    // La suppression est scopée au serveur : un ID venant d'ailleurs ne
    // correspondra à aucun devoir de cette guild.
    const result = devoirsService.deleteDevoir(
      interaction.guildId,
      interaction.options.getString('devoir', true)
    )

    if (!result.ok) {
      return interaction.reply({
        content: `❌ ${result.error}`,
        flags: MessageFlags.Ephemeral
      })
    }

    const { devoir, cancelledCount } = result
    const category = devoirsService.getDevoirCategory(interaction.guildId, devoir)
    const subject = devoir.matiere ? `**${devoir.matiere}** → ${devoir.titre}` : `**${devoir.titre}**`

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🗑️ Suppression effectuée')
      .setDescription(
        `L'élément suivant a été supprimé :\n\n${subject}\n` +
          `📅 ${devoirsService.formatEcheance(devoir)}\n` +
          `🗂️ ${categoriesService.formatCategory(category)}`
      )
      .addFields({
        name: '🔕 Rappels persistants',
        value: `${cancelledCount} rappel(s) annulé(s)`
      })
      .setTimestamp()
      .setFooter({
        text: 'Bot Discord 4SIB',
        iconURL: interaction.client.user.displayAvatarURL()
      })

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })

    await interaction.client.refreshDevoirBoard?.(interaction.guildId)
  },

  async autocomplete (interaction) {
    await respondWithDevoirs(interaction)
  }
}
