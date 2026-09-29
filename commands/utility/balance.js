const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const points = require('../../src/utils/points')
module.exports = {
  data: new SlashCommandBuilder().setName('balance').setDescription("solde d'un utilisateur").addUserOption(o => o.setName('user').setDescription('Utilisateur')),
  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user
    const bal = points.getBalance(user.id)
    const embed = new EmbedBuilder().setTitle(`${user.tag}`).setDescription(`${bal} points`).setColor('#00AAFF')
    await interaction.reply({ embeds: [embed] })
  }
}
