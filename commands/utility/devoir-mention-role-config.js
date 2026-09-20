const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js')
const { readConfig, writeConfig } = require('../../services/devoirsService')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('devoir-mention-role-config')
    .setDescription(
      'Définit le rôle mentionné dans les rappels de devoirs/examens (ou @everyone par défaut).'
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(['Guild'])
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription(
          'Rôle à mentionner dans les rappels (laisser vide pour revenir à @everyone)'
        )
        .setRequired(false)
    ),
  emoji: '🔔',

  async execute (interaction) {
    // Vérif au cas où
    if (
      !interaction.memberPermissions ||
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
    ) {
      return interaction.reply({
        content:
          'Tu n’as pas la permission de configurer le rôle des rappels (ManageGuild requis).',
        flags: MessageFlags.Ephemeral
      })
    }

    const guildId = interaction.guildId
    if (!guildId) {
      return interaction.reply({
        content: 'Cette commande doit être utilisée dans un serveur.',
        flags: MessageFlags.Ephemeral
      })
    }

    const role = interaction.options.getRole('role')
    const cfg = readConfig()

    if (!cfg[guildId]) cfg[guildId] = { roleId: null }

    if (!role) {
      // reset -> @everyone
      cfg[guildId].roleId = null
    } else {
      cfg[guildId].roleId = role.id
    }

    writeConfig(cfg)

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Configuration des rappels mise à jour')
      .setDescription(
        role
          ? `Les rappels de devoirs/examens mentionneront désormais le rôle ${role}.`
          : 'Les rappels de devoirs/examens mentionneront désormais **@everyone**.'
      )
      .setTimestamp()
      .setFooter({
        text: 'Bot Discord 4SIB', // je vais vraiment finir par mettre un easter egg à cet endroit (et à automatiser ça)
        iconURL: interaction.client.user.displayAvatarURL()
      })

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    })
  }
}
