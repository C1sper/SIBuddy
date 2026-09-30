const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')

const devoirsService = require('../../services/devoirsService')
const categoriesService = require('../../services/categoriesService')
const { isFeatureEnabled } = require('../../services/guildConfig')
const { respondWithCategories } = require('../../utils/devoirAutocomplete')

const { IMPORTANCE_LABELS } = devoirsService

module.exports = {
  data: new SlashCommandBuilder()
    .setName('liste-devoirs')
    .setDescription('Affiche la liste des dates importantes de ce serveur.')
    .setContexts(['Guild'])
    .addStringOption(option =>
      option
        .setName('categorie')
        .setDescription('Filtrer par catégorie')
        .setRequired(false)
        .setAutocomplete(true)
    ),
  emoji: '📚',

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
    const categoryRef = interaction.options.getString('categorie')

    // Filtre facultatif : on résout la référence sur CE serveur uniquement.
    let filterCategory = null
    if (categoryRef) {
      filterCategory = categoriesService.resolveCategory(guildId, categoryRef)
      if (!filterCategory) {
        return interaction.reply({
          content: '❌ Cette catégorie n’existe pas sur ce serveur.',
          flags: MessageFlags.Ephemeral
        })
      }
    }

    const devoirs = devoirsService.listDevoirs({
      guildId,
      categoryId: filterCategory ? filterCategory.id : null
    })

    if (devoirs.length === 0) {
      return interaction.reply({
        content: '📭 Aucun élément correspondant n’a été trouvé.',
        flags: MessageFlags.Ephemeral
      })
    }

    const max = 20
    const slice = devoirs.slice(0, max)

    const desc = slice
      .map((d, i) => {
        const category = devoirsService.getDevoirCategory(guildId, d)
        const impLabel = IMPORTANCE_LABELS[d.importance] || 'Important'
        const subject = d.matiere ? `**${d.matiere}** → ${d.titre}` : `**${d.titre}**`
        const echeance = devoirsService.formatEcheance(d)

        return (
          `**${i + 1}.** ${subject}\n` +
          `🗂️ ${categoriesService.formatCategory(category)} — 📅 ${echeance} — 📍 ${impLabel}\n` +
          (d.description ? `📝 ${d.description}\n` : '') +
          '​'
        )
      })
      .join('\n')

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(
        filterCategory
          ? `📚 ${categoriesService.formatCategory(filterCategory)}`
          : '📚 Dates importantes'
      )
      .setDescription(desc)
      .setFooter({
        text:
          slice.length < devoirs.length
            ? `Affichage des ${slice.length} premiers éléments (sur ${devoirs.length})`
            : 'Tous les éléments sont affichés'
      })
      .setTimestamp()

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
  },

  async autocomplete (interaction) {
    // Le filtre peut porter sur une catégorie désactivée (d'anciens devoirs
    // y sont peut-être encore rattachés).
    await respondWithCategories(interaction, { enabledOnly: false })
  }
}
