const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js')
module.exports = {
  data: new SlashCommandBuilder().setName('f1-race').setDescription('Parier sur une écurie et regarder la course').addIntegerOption(o => o.setName('bet').setDescription('Mise en points').setRequired(false)),
  async execute(interaction) {
    const points = require('../../src/utils/points')
    const userBal = points.getBalance(interaction.user.id)
    const bet = Math.max(0, Math.min(interaction.options.getInteger('bet') || 0, userBal))
    const teams = [
      { id: 'mercedes', name: 'Mercedes', power: 95 },
      { id: 'ferrari', name: 'Ferrari', power: 92 },
      { id: 'redbull', name: 'Red Bull', power: 97 },
      { id: 'mclaren', name: 'McLaren', power: 88 },
      { id: 'aston', name: 'Aston Martin', power: 85 },
      { id: 'alpine', name: 'Alpine', power: 83 }
    ]
    const options = teams.map(t => ({ label: t.name, value: t.id }))
    const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_team').setPlaceholder('Choisis ton écurie').addOptions(options))
  await interaction.reply({ content: `Tu as ${userBal} points. Tu paries ${bet} points. Choisis une écurie:`, components: [row] })
    const msg = await interaction.fetchReply()
    const filter = i => i.user.id === interaction.user.id && i.customId === 'select_team'
    const collector = msg.createMessageComponentCollector({ filter, time: 60000, max: 1 })
    collector.on('collect', async i => {
      await i.deferUpdate()
      const choice = i.values[0]
      const chosen = teams.find(t => t.id === choice)
      const positions = teams.map(t => ({ id: t.id, name: t.name, pos: 0, power: t.power }))
      const totalSteps = 12
      const startEmbed = new EmbedBuilder().setTitle('Grand Prix').setDescription(`Pari: ${bet} | Ta team: ${chosen.name}`).setColor('#00AAFF')
      await interaction.editReply({ content: null, embeds: [startEmbed], components: [] })
      for (let step = 0; step <= totalSteps; step++) {
        for (const p of positions) {
          const advance = Math.random() * (p.power / 100) + 0.05
          p.pos += advance
        }
        positions.sort((a, b) => b.pos - a.pos)
        const trackLen = 20
        const lines = positions.map((p, idx) => {
          const prog = Math.min(trackLen, Math.floor((p.pos / (totalSteps * 1.5)) * trackLen))
          const bar = '▬'.repeat(prog) + '🏁' + ' '.repeat(Math.max(0, trackLen - prog))
          const car = idx === 0 ? '🏎️' : '🚗'
          return `${car} **${p.name}**\n${bar}`
        }).join('\n\n')
        const leader = positions[0].name
        const e = new EmbedBuilder().setTitle('Grand Prix').setDescription(`${lines}\n\nLeader: **${leader}**`).setColor('#00AAFF').setFooter({ text: `Étape ${step}/${totalSteps}` })
        await interaction.editReply({ embeds: [e] })
        await new Promise(r => setTimeout(r, 800))
      }
      const winner = positions[0].name
      const won = winner === chosen.name
      if (bet > 0) {
        if (won) points.add(interaction.user.id, bet)
        else points.add(interaction.user.id, -bet)
      }
      const finalBal = points.getBalance(interaction.user.id)
      const result = new EmbedBuilder().setTitle('Résultat').setDescription(`Gagnant: **${winner}**\nTon choix: **${chosen.name}**\nTu ${won ? 'gagnes' : 'perds'} ${bet} points\nSolde: ${finalBal} points`).setColor(won ? '#00FF00' : '#FF0000')
      await interaction.editReply({ embeds: [result] })
    })
    collector.on('end', collected => {
      if (collected.size === 0) interaction.editReply({ content: 'Temps écoulé, course annulée.', components: [] }).catch(() => {})
    })
  }
}
