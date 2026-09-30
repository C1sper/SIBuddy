const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')

const { addReminder } = require('../../services/remindersStore')
const devoirsService = require('../../services/devoirsService')
const { parseDateTimeLocal } = require('../../services/dateParser')
const { isFeatureEnabled } = require('../../services/guildConfig')
const { respondWithDevoirs } = require('../../utils/devoirAutocomplete')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mp-rappel-devoir')
    .setDescription('Planifie un rappel privé (DM) sur une date importante.')
    .setContexts(['Guild'])
    .addStringOption(o =>
      o
        .setName('devoir')
        .setDescription('Élément concerné (filtré automatiquement)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(o =>
      o.setName('date').setDescription('Format AAAA-MM-JJ').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('heure').setDescription('Format HH:mm').setRequired(true)
    ),

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
    const dateStr = interaction.options.getString('date', true)
    const heureStr = interaction.options.getString('heure', true)

    // Recherche restreinte au serveur courant : impossible de programmer un
    // rappel sur un devoir appartenant à un autre serveur.
    const devoir = devoirsService
      .readDevoirs(interaction.guildId)
      .find(d => devoirsService.sameId(d.id, devoirId))

    if (!devoir) {
      return interaction.reply({
        content: '❌ Cet élément n’existe plus sur ce serveur.',
        flags: MessageFlags.Ephemeral
      })
    }

    const target = parseDateTimeLocal(dateStr, heureStr)
    if (!target) {
      return interaction.reply({
        content: '❌ Format de date/heure invalide (attendu : AAAA-MM-JJ et HH:mm).',
        flags: MessageFlags.Ephemeral
      })
    }

    if (target.getTime() <= Date.now()) {
      return interaction.reply({
        content: '❌ Le rappel doit être programmé dans le futur.',
        flags: MessageFlags.Ephemeral
      })
    }

    const category = devoirsService.getDevoirCategory(interaction.guildId, devoir)

    const reminder = addReminder({
      delivery: 'dm',
      guildId: interaction.guildId,
      userId: interaction.user.id,

      devoirId: devoir.id,
      kind: 'dm-custom',
      title: devoir.titre,
      matiere: devoir.matiere || '',
      categoryId: category ? category.id : null,
      type: devoir.type || null,
      importance: devoir.importance,
      date: devoir.date,
      heure: devoir.heure || null,
      description: devoir.description || '',
      remindAtISO: target.toISOString()
    })

    const subject = devoir.matiere ? `**${devoir.matiere}** → ${devoir.titre}` : `**${devoir.titre}**`

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('✅ Rappel privé programmé')
      .setDescription(`Je t’enverrai un DM pour ${subject}.`)
      .addFields(
        { name: '📅 Quand', value: `${dateStr} à ${heureStr}` },
        { name: '🆔 ID rappel', value: reminder.id }
      )
      .setTimestamp()

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
  },

  async autocomplete (interaction) {
    await respondWithDevoirs(interaction)
  }
}
