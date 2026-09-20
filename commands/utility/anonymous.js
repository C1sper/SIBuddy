const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');

const log = createLogger('commands');

// Empêche les pings @everyone, @here, rôles et users (normalement)
function sanitizeForNoPings(text) {
  return text
    .replaceAll(/@everyone/gi, "@\u200beveryone")
    .replaceAll(/@here/gi, "@\u200bhere")
    .replaceAll(/<@&/g, "<@\u200b&")
    .replaceAll(/<@!/g, "<@\u200b!")
    .replaceAll(/<@/g, "<@\u200b");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("anonymous")
    .setDescription(
      "Envoie anonymement un message via le bot dans ce salon ou un autre."
    )
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("Le contenu du message anonyme")
        .setRequired(true)
        .setMaxLength(2000)
    )
    .addChannelOption((option) =>
      option
        .setName("salon")
        .setDescription(
          "Salon cible (par défaut : celui où la commande est exécutée)"
        )
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),
    emoji: '💬',

  async execute(interaction) {
    const raw = interaction.options.getString("message", true);
    const targetChannel =
      interaction.options.getChannel("salon") || interaction.channel;

    // Vérif du type de salon
    if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
      return interaction.reply({
        content:
          "Je ne peux envoyer des messages que dans un salon textuel du serveur.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Vérif permissions d’envoi pour le bot
    const perms = targetChannel.permissionsFor(interaction.client.user.id);
    if (!perms || !perms.has(PermissionFlagsBits.SendMessages)) {
      return interaction.reply({
        content:
          "Je n’ai pas la permission d’envoyer des messages dans ce salon.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const content = sanitizeForNoPings(raw);

    try {
      await targetChannel.send({
        content,
        allowedMentions: { parse: [], repliedUser: false }, // anti-pings au cas où
      });

      // Confirmation éphémère stylée
      const confirm = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ Message anonyme envoyé")
        .setDescription(
          targetChannel.id === interaction.channelId
            ? "Ton message a été posté anonymement dans ce salon."
            : `Ton message a été posté anonymement dans <#${targetChannel.id}>.`
        )
        .setFooter({
          text: "Bot Discord 4SIB",
          iconURL: interaction.client.user.displayAvatarURL(),
        })
        .setTimestamp();

      await interaction.reply({ embeds: [confirm], flags: MessageFlags.Ephemeral });
    } catch (err) {
      log.error("Anonymous send error:", err);
      await interaction.reply({
        content: "Une erreur est survenue lors de l’envoi du message.",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
