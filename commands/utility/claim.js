const { SlashCommandBuilder } = require('discord.js')
const claims = require('../../src/utils/claims')
const points = require('../../src/utils/points')
module.exports = {
  data: new SlashCommandBuilder().setName('claim').setDescription('4h de coolwown'),
  async execute(interaction) {
    const uid = interaction.user.id
    if (!claims.canClaim(uid)) {
      const rem = claims.getRemaining(uid)
      const hours = Math.floor(rem / 3600)
      const mins = Math.floor((rem % 3600) / 60)
      return interaction.reply({ content: `tu dois attendre ${hours}h ${mins}m`, ephemeral: true })
    }
    const amount = 100
    points.add(uid, amount)
    claims.setClaim(uid)
    await interaction.reply({ content: `récole de ${amount} points` })
  }
}
