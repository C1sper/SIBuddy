// interactions/adminPanelHandler.js
// Panel d'administration Discord (/admin-panel). Gère la vue principale et
// route les sous-parties (feur, devoirs) vers leurs handlers dédiés.
// Toutes les interactions du panel utilisent le préfixe "admin:".
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

const { ensureGuildConfig, updateGuildConfig } = require('../services/guildConfig');
const devoirsService = require('../services/devoirsService');
const categoriesService = require('../services/categoriesService');
const { ensureGuildInitialized } = require('../services/guildLifecycle');
const feurPanelHandler = require('./feurPanelHandler');
const homeworkPanelHandler = require('./homeworkPanelHandler');
const categoriesPanelHandler = require('./categoriesPanelHandler');

const { createLogger } = require('../utils/logger');

const log = createLogger('adminPanel');
const FEATURE_LABELS = {
  feur: 'Réponses "feur"',
  homework: 'Devoirs',
  stats: 'Statistiques',
  rss: 'RSS',
  recurringEvents: 'Événements récurrents',
};

/**
 * Contrôle rejoué à CHAQUE interaction du panel (bouton, menu, modal), et pas
 * seulement à l'ouverture : un bouton d'un vieux panel encore affiché est donc
 * revérifié. Exige aussi que la guild soit résolue, car toutes les vues
 * lisent les données via `interaction.guild.id`.
 */
function hasAdminAccess(interaction) {
  if (!interaction.inGuild() || !interaction.guild) return false;
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

async function denyAccess(interaction) {
  const payload = {
    content: '❌ Tu dois avoir la permission **Gérer le serveur** (ou Administrateur) pour utiliser ce panel.',
    flags: MessageFlags.Ephemeral,
  };
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply(payload);
  }
}

function buildMainPanel(guild) {
  // Garantit que data/guilds/<guildId>/ existe dès la première ouverture du panel.
  ensureGuildInitialized(guild.id);

  const cfg = ensureGuildConfig(guild.id);
  const devoirsCfg = devoirsService.getGuildConfig(guild.id);
  const devoirsCount = devoirsService.getUpcoming(guild.id).length;
  const categories = categoriesService.listCategories(guild.id);
  const activeCategories = categories.filter((c) => c.enabled).length;

  const stateIcon = (v) => (v ? '🟢 Activé' : '🔴 Désactivé');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🛠️ Panel d'administration — ${guild.name}`)
    .setDescription('Gère les fonctionnalités du bot pour ce serveur. Ce panel est visible uniquement par toi.')
    .addFields(
      {
        name: '⚙️ Fonctionnalités',
        value: Object.entries(cfg.features)
          .map(([key, val]) => `${stateIcon(val)} — ${FEATURE_LABELS[key] || key}`)
          .join('\n'),
      },
      {
        name: '🎲 Feur',
        value: `Règles configurées : **${cfg.feur.rules.length}**\nCooldown : **${cfg.feur.cooldownMinutes} min**`,
        inline: true,
      },
      {
        name: '📚 Devoirs',
        value:
          `Dates à venir : **${devoirsCount}**\n` +
          `Salon tableau : ${devoirsCfg.boardChannelId ? `<#${devoirsCfg.boardChannelId}>` : 'non configuré'}`,
        inline: true,
      },
      {
        name: '📂 Catégories',
        value: `**${activeCategories}** active(s) sur **${categories.length}**`,
        inline: true,
      },
    )
    .setFooter({ text: 'Utilise le menu ou les boutons ci-dessous pour naviguer.' })
    .setTimestamp();

  const featureSelect = new StringSelectMenuBuilder()
    .setCustomId('admin:features:select')
    .setPlaceholder('Activer / désactiver une fonctionnalité...')
    .addOptions(
      Object.entries(cfg.features).map(([key, val]) => ({
        label: `${FEATURE_LABELS[key] || key} (${val ? 'activé' : 'désactivé'})`,
        value: key,
        emoji: val ? '🟢' : '🔴',
      })),
    );

  const rowSelect = new ActionRowBuilder().addComponents(featureSelect);
  const rowButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:hw:open').setLabel('Devoirs').setEmoji('📚').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:cat:open').setLabel('Catégories').setEmoji('📂').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:feur:open').setLabel('Feur').setEmoji('🎲').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:home').setLabel('Actualiser').setEmoji('🔄').setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [rowSelect, rowButtons] };
}

async function showMainPanel(interaction) {
  const payload = buildMainPanel(interaction.guild);
  if (interaction.isModalSubmit() || interaction.isMessageComponent()) {
    await interaction.update(payload);
  } else {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }
}

async function handleFeatureToggle(interaction) {
  const feature = interaction.values?.[0];
  if (!feature || !FEATURE_LABELS[feature]) {
    return interaction.update(buildMainPanel(interaction.guild));
  }

  updateGuildConfig(interaction.guildId, (cfg) => {
    cfg.features[feature] = !cfg.features[feature];
    return cfg;
  });

  await interaction.update(buildMainPanel(interaction.guild));
}

/**
 * Point d'entrée : route toutes les interactions dont le customId commence
 * par "admin:" (boutons, menus de sélection, modals).
 */
async function route(interaction) {
  if (!hasAdminAccess(interaction)) {
    return denyAccess(interaction);
  }

  const customId = interaction.customId;
  const parts = customId.split(':'); // ["admin", section, ...rest]
  const section = parts[1];

  try {
    if (section === 'home') {
      return await showMainPanel(interaction);
    }

    if (section === 'features' && interaction.isStringSelectMenu()) {
      return await handleFeatureToggle(interaction);
    }

    if (section === 'feur') {
      return await feurPanelHandler.route(interaction, parts.slice(2));
    }

    if (section === 'hw') {
      return await homeworkPanelHandler.route(interaction, parts.slice(2));
    }

    if (section === 'cat') {
      return await categoriesPanelHandler.route(interaction, parts.slice(2));
    }

    // customId admin: inconnu / panel expiré -> retour à l'accueil
    return await showMainPanel(interaction);
  } catch (error) {
    log.error(`Erreur sur ${customId}:`, error);
    const errorPayload = { content: '❌ Une erreur est survenue. Réessaie ou relance `/admin-panel`.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(errorPayload);
      } else {
        await interaction.reply(errorPayload);
      }
    } catch { /* interaction probablement expirée */ }
  }
}

module.exports = {
  hasAdminAccess,
  buildMainPanel,
  showMainPanel,
  route,
  FEATURE_LABELS,
};
