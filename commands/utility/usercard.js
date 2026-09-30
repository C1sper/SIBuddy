
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
module.exports = {
	data: new SlashCommandBuilder().setName('usercard').setDescription("Affiche une carte d'info utilisateur").addUserOption(o => o.setName('user').setDescription('Utilisateur')),
	async execute(interaction) {
		const user = interaction.options.getUser('user') || interaction.user
		const member = interaction.options.getMember('user') || interaction.member
		const created = user.createdAt ? `<t:${Math.floor(user.createdAt.getTime()/1000)}:f>` : 'N/A'
		const joined = member && member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime()/1000)}:f>` : 'N/A'
		const roles = member && member.roles ? member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join(', ') || 'Aucun' : 'N/A'
		const embed = new EmbedBuilder().setTitle(`${user.tag}`).setThumbnail(user.displayAvatarURL({ extension: 'png', size: 1024 })).addFields(
			{ name: 'ID', value: `${user.id}`, inline: true },
			{ name: 'Compte créé', value: `${created}`, inline: true },
			{ name: 'Serveur', value: `${joined}`, inline: true },
			{ name: 'Rôles', value: `${roles}`, inline: false }
		).setColor('#00AAFF')
		await interaction.reply({ embeds: [embed] })
	}
}

