const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const statsStore = require("../../services/statsStore");
const { isFeatureEnabled } = require("../../services/guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mystats")
    .setDescription("Affiche ton nombre de messages sur ce serveur")
    .setContexts(["Guild"]),
  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: "❌ Cette commande doit être utilisée dans un serveur.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!isFeatureEnabled(interaction.guildId, "stats")) {
      return interaction.reply({
        content: "📊 La collecte des statistiques est désactivée sur ce serveur.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const count = statsStore.getMessageCount(interaction.guildId, interaction.user.id);
    await interaction.reply({
      content: `📊 Tu as envoyé **${count}** message(s) sur ce serveur.`,
      flags: MessageFlags.Ephemeral,
    });
  }
};
