// commands/utility/ajouter-devoir.js
// La catégorie n'est plus une liste de choix figée : elle est autocomplétée
// dynamiquement à partir des catégories du serveur courant. Ajouter une
// catégorie depuis le panel ne nécessite donc AUCUN redéploiement des
// commandes slash.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')

const devoirsService = require('../../services/devoirsService')
const categoriesService = require('../../services/categoriesService')
const { isFeatureEnabled } = require('../../services/guildConfig')
const { respondWithCategories } = require('../../utils/devoirAutocomplete')

const { IMPORTANCE_LABELS } = devoirsService

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ajouter-devoir')
    .setDescription('Ajoute une date importante (devoir, examen, projet...) avec rappels J-7 et J-1.')
    .setContexts(['Guild'])
    .addStringOption(option =>
      option
        .setName('matiere')
        .setDescription('Matière (ex : Cryptographie)')
        .setRequired(true)
        .setMaxLength(60)
    )
    .addStringOption(option =>
      option
        .setName('titre')
        .setDescription('Nom de la tâche (ex : TP RSA)')
        .setRequired(true)
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option
        .setName('date')
        .setDescription('Date limite (format AAAA-MM-JJ)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('categorie')
        .setDescription('Catégorie du serveur (autocomplétée)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option
        .setName('heure')
        .setDescription('Heure limite (HH:mm). Par défaut : minuit.')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('importance')
        .setDescription('Importance : peu important / important / très important')
        .setRequired(false)
        .addChoices(
          { name: 'peu important', value: 'faible' },
          { name: 'important', value: 'important' },
          { name: 'très important', value: 'tres_important' }
        )
    )
    .addStringOption(option =>
      option
        .setName('description')
        .setDescription('Description')
        .setRequired(false)
        .setMaxLength(1000)
    )
    .addStringOption(option =>
      option
        .setName('timings')
        .setDescription("Timings custom pour CE devoir (ex: '3j,12h,45m')")
        .setRequired(false)
    ),
  emoji: '🧾',

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

    // La valeur reçue de l'autocomplétion n'est jamais considérée comme fiable :
    // devoirsService.addDevoir revérifie que la catégorie existe, appartient
    // bien à ce serveur et est toujours active.
    const result = devoirsService.addDevoir({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      matiere: interaction.options.getString('matiere', true),
      titre: interaction.options.getString('titre', true),
      date: interaction.options.getString('date', true),
      heure: interaction.options.getString('heure') || null,
      categoryRef: interaction.options.getString('categorie', true),
      importance: interaction.options.getString('importance') || 'important',
      description: interaction.options.getString('description') || '',
      timingsStr: interaction.options.getString('timings') || ''
    })

    if (!result.ok) {
      return interaction.reply({
        content: `❌ ${result.error}`,
        flags: MessageFlags.Ephemeral
      })
    }

    const { devoir, category, remindersCreated } = result

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`✅ ${categoriesService.formatCategory(category)} ajouté`)
      .addFields(
        { name: '📗 Matière', value: devoir.matiere || '—', inline: true },
        { name: '📘 Nom', value: devoir.titre, inline: true },
        { name: '📍 Importance', value: IMPORTANCE_LABELS[devoir.importance] || 'Important', inline: true },
        {
          name: '📅 Date limite',
          value: devoirsService.formatEcheance(devoir),
          inline: true
        },
        { name: '🗂️ Catégorie', value: categoriesService.formatCategory(category), inline: true },
        { name: '📝 Description', value: devoir.description || 'Aucune' },
        { name: '📢 Salon des rappels', value: `<#${interaction.channelId}>` }
      )
      .setTimestamp()
      .setFooter({
        text: 'Bot Discord 4SIB',
        iconURL: interaction.client.user.displayAvatarURL()
      })

    if (devoir.customTimings.length > 0) {
      embed.addFields({
        name: '⏱️ Timings personnalisés (pour ce devoir)',
        value: devoir.customTimings.map(t => `• ${t.label}`).join('\n')
      })
    }

    if (remindersCreated.length > 0) {
      embed.addFields({
        name: '🔔 Rappels programmés (persistants)',
        value: remindersCreated
          .map(r => `• ${r.kind} → ${new Date(r.remindAtISO).toLocaleString('fr-FR')}`)
          .join('\n')
      })
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })

    // Le tableau des dates importantes reflète immédiatement l'ajout.
    await interaction.client.refreshDevoirBoard?.(interaction.guildId)
  },

  async autocomplete (interaction) {
    await respondWithCategories(interaction)
  }
}
