const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js')
const { readConfig, writeConfig } = require('../../services/devoirsService')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('devoir-salon-rappels')
    .setDescription('Définit le salon unique où tous les rappels seront envoyés.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(['Guild'])
    .addChannelOption(option =>
      option
        .setName('salon')
        .setDescription('Salon où envoyer tous les rappels (laisser vide pour revenir au comportement par défaut)')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    ),
  emoji: '📣',

  async execute (interaction) {
    const guildId = interaction.guildId
    if (!guildId) {
      return interaction.reply({
        content: 'Cette commande doit être utilisée dans un serveur.',
        flags: MessageFlags.Ephemeral
      })
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "Tu n'as pas la permission (ManageGuild requis).",
        flags: MessageFlags.Ephemeral
      })
    }

    const channel = interaction.options.getChannel('salon')
    const cfg = readConfig()
    if (!cfg[guildId]) cfg[guildId] = { roleId: null, customTimings: [] }

    cfg[guildId].reminderChannelId = channel ? channel.id : null
    writeConfig(cfg)

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Configuration des rappels mise à jour')
      .setDescription(
        channel
          ? `✅ Tous les rappels seront désormais envoyés dans ${channel}.`
          : '✅ Les rappels utiliseront le salon de création (comportement par défaut).'
      )
      .setTimestamp()
      .setFooter({
        text: 'Bot Discord 4SIB',
        iconURL: interaction.client.user.displayAvatarURL()
      })

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
  }
}
