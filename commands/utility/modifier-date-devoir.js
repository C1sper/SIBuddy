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
    .setName('modifier-date-devoir')
    .setDescription('Modifie la date limite d’une date importante.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(['Guild'])
    .addStringOption(option =>
      option
        .setName('devoir')
        .setDescription('Choisis l’élément à modifier')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option
        .setName('date')
        .setDescription('Nouvelle date limite (format AAAA-MM-JJ)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('heure')
        .setDescription('Nouvelle heure limite (HH:mm). Par défaut : minuit.')
        .setRequired(false)
    ),
  emoji: '🗓️',

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

    const devoirId = interaction.options.getString('devoir', true)
    const patch = { date: interaction.options.getString('date', true) }

    const heure = interaction.options.getString('heure')
    if (heure !== null) patch.heure = heure

    const devoirsBefore = devoirsService.readDevoirs(interaction.guildId)
    const before = devoirsBefore.find(d => devoirsService.sameId(d.id, devoirId))
    const oldDate = before ? devoirsService.formatEcheance(before) : null

    const result = devoirsService.updateDevoir(interaction.guildId, devoirId, patch)
    if (!result.ok) {
      return interaction.reply({
        content: `❌ ${result.error}`,
        flags: MessageFlags.Ephemeral
      })
    }

    const { devoir, reminders } = result
    const category = devoirsService.getDevoirCategory(interaction.guildId, devoir)
    const subject = devoir.matiere ? `**${devoir.matiere}** → ${devoir.titre}` : `**${devoir.titre}**`

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('🗓️ Date modifiée')
      .setDescription(
        `La date de ${subject} (${categoriesService.formatCategory(category)}) a été mise à jour.`
      )
      .addFields(
        { name: 'Ancienne date', value: oldDate || 'Inconnue', inline: true },
        {
          name: 'Nouvelle date',
          value: devoirsService.formatEcheance(devoir),
          inline: true
        },
        {
          name: '🔔 Rappels persistants',
          value:
            reminders.length > 0
              ? `Anciens rappels annulés, ${reminders.length} nouveau(x) rappel(s) programmé(s).`
              : 'Aucun (date trop proche ou passée, ou salon d’origine manquant)'
        }
      )
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
