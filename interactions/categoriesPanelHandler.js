// interactions/categoriesPanelHandler.js
// Sous-panel "Catégories" du panel d'administration (customId préfixés "admin:cat:").
//
// Toute la logique métier vit dans services/categoriesService.js : ce fichier
// ne fait que construire l'interface et router les interactions.
//
// Les customId ne contiennent QUE des identifiants stables (`cat_xxxxxx`),
// jamais de nom de catégorie ni de texte saisi par un utilisateur.
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const categoriesService = require('../services/categoriesService');

const MAX_OPTIONS = 25; // limite Discord d'un select menu

// ---------------------------------------------------------------------------
// Vues
// ---------------------------------------------------------------------------

function buildCategoriesPanel(guild, notice = null) {
  const categories = categoriesService.listCategories(guild.id);
  const activeCount = categories.filter(c => c.enabled).length;

  const lines = categories.map(cat => {
    const usage = categoriesService.countCategoryUsage(guild.id, cat.id);
    const total = usage.active + usage.archived;
    const state = cat.enabled ? '✅' : '❌';
    return `${state} ${categoriesService.formatCategory(cat)} — ${total} devoir(s)`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📂 Catégories')
    .setDescription(
      (notice ? `${notice}\n\n` : '') +
      `${categories.length} catégorie(s), dont **${activeCount}** active(s).\n\n` +
      lines.join('\n') +
      '\n\n_Une catégorie désactivée reste attachée aux anciens devoirs, ' +
      'mais n’est plus proposée à la création._',
    )
    .setFooter({ text: 'Les catégories sont propres à ce serveur.' })
    .setTimestamp();

  const rowActions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:cat:add').setLabel('Ajouter').setEmoji('➕').setStyle(ButtonStyle.Success)
      .setDisabled(categories.length >= categoriesService.MAX_CATEGORIES),
    new ButtonBuilder().setCustomId('admin:cat:edit:menu').setLabel('Modifier').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:cat:toggle:menu').setLabel('Activer / Désactiver').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
  );

  const rowManage = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:cat:delete:menu').setLabel('Supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
      .setDisabled(categories.length <= 1),
    new ButtonBuilder().setCustomId('admin:cat:order').setLabel('Ordre').setEmoji('↕️').setStyle(ButtonStyle.Secondary)
      .setDisabled(categories.length <= 1),
  );

  const rowNav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:home').setLabel('Retour').setEmoji('◀️').setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [rowActions, rowManage, rowNav] };
}

/** Select menu générique listant les catégories du serveur. */
function buildCategorySelect(guild, customId, placeholder, { enabledOnly = false } = {}) {
  const categories = categoriesService
    .listCategories(guild.id, { enabledOnly })
    .slice(0, MAX_OPTIONS);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder.slice(0, 150))
    .addOptions(
      categories.map(cat => ({
        label: cat.name.slice(0, 100),
        description: `${cat.enabled ? 'Active' : 'Désactivée'} — position ${cat.order + 1}`.slice(0, 100),
        value: cat.id,
        ...(cat.emoji && !cat.emoji.startsWith('<') ? { emoji: cat.emoji } : {}),
      })),
    );

  return {
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📂 Catégories').setDescription(placeholder)],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin:cat:open').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildCategoryModal(customId, title, { name = '', emoji = '' } = {}) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45));

  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Nom de la catégorie')
    .setPlaceholder('Ex : Oral')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(categoriesService.NAME_MAX_LENGTH)
    .setRequired(true);
  if (name) nameInput.setValue(name);

  const emojiInput = new TextInputBuilder()
    .setCustomId('emoji')
    .setLabel('Emoji (facultatif)')
    .setPlaceholder('Ex : 🎤')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(categoriesService.EMOJI_MAX_LENGTH)
    .setRequired(false);
  if (emoji) emojiInput.setValue(emoji);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(emojiInput),
  );
  return modal;
}

/** Vue proposée lorsqu'on tente de supprimer une catégorie encore utilisée. */
function buildReassignView(guild, category, usage) {
  const others = categoriesService
    .listCategories(guild.id)
    .filter(c => c.id !== category.id)
    .slice(0, MAX_OPTIONS);

  const total = usage.active + usage.archived;

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('⚠️ Catégorie utilisée')
    .setDescription(
      `**${categoriesService.formatCategory(category)}** est utilisée par **${total} devoir(s)** ` +
      `(${usage.active} actif(s), ${usage.archived} archivé(s)).\n\n` +
      'Choisis une catégorie de destination : les devoirs y seront réattribués, ' +
      'puis la suppression sera possible. **Aucun devoir n’est supprimé.**',
    );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`admin:cat:reassign:select:${category.id}`)
    .setPlaceholder('Réattribuer les devoirs vers...')
    .addOptions(
      others.map(cat => ({
        label: cat.name.slice(0, 100),
        description: cat.enabled ? 'Active' : 'Désactivée',
        value: cat.id,
        ...(cat.emoji && !cat.emoji.startsWith('<') ? { emoji: cat.emoji } : {}),
      })),
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin:cat:open').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

/** Vue de réordonnancement d'une catégorie (boutons Monter / Descendre). */
function buildOrderView(guild, categoryId, notice = null) {
  const categories = categoriesService.listCategories(guild.id);
  const category = categories.find(c => c.id === categoryId);

  if (!category) return buildCategoriesPanel(guild, '❌ Cette catégorie n’existe plus.');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('↕️ Ordre des catégories')
    .setDescription(
      (notice ? `${notice}\n\n` : '') +
      categories
        .map((c, i) => `${c.id === category.id ? '**➤**' : '   '} ${i + 1}. ${categoriesService.formatCategory(c)}`)
        .join('\n'),
    );

  const index = categories.findIndex(c => c.id === category.id);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`admin:cat:order:up:${category.id}`).setLabel('Monter').setEmoji('⬆️')
          .setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId(`admin:cat:order:down:${category.id}`).setLabel('Descendre').setEmoji('⬇️')
          .setStyle(ButtonStyle.Secondary).setDisabled(index === categories.length - 1),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin:cat:order').setLabel('Autre catégorie').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('admin:cat:open').setLabel('Retour').setEmoji('◀️').setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------

async function route(interaction, parts) {
  const guild = interaction.guild;
  const [action, sub, maybeId] = parts;

  // --- Boutons -------------------------------------------------------------
  if (interaction.isButton()) {
    if (action === 'open') return interaction.update(buildCategoriesPanel(guild));

    if (action === 'add') {
      return interaction.showModal(buildCategoryModal('admin:cat:add:submit', 'Ajouter une catégorie'));
    }

    if (action === 'edit' && sub === 'menu') {
      return interaction.update(buildCategorySelect(guild, 'admin:cat:edit:select', 'Choisis la catégorie à modifier...'));
    }

    if (action === 'toggle' && sub === 'menu') {
      return interaction.update(buildCategorySelect(guild, 'admin:cat:toggle:select', 'Choisis la catégorie à activer/désactiver...'));
    }

    if (action === 'delete' && sub === 'menu') {
      return interaction.update(buildCategorySelect(guild, 'admin:cat:delete:select', 'Choisis la catégorie à supprimer...'));
    }

    if (action === 'order' && !sub) {
      return interaction.update(buildCategorySelect(guild, 'admin:cat:order:select', 'Choisis la catégorie à déplacer...'));
    }

    if (action === 'order' && (sub === 'up' || sub === 'down')) {
      const result = categoriesService.moveCategory(guild.id, maybeId, sub);
      return interaction.update(
        buildOrderView(guild, maybeId, result.ok ? '✅ Ordre mis à jour.' : `❌ ${result.error}`),
      );
    }
  }

  // --- Menus de sélection --------------------------------------------------
  if (interaction.isStringSelectMenu()) {
    const selected = interaction.values?.[0];

    if (action === 'edit' && sub === 'select') {
      const category = categoriesService.getCategory(guild.id, selected);
      if (!category) {
        return interaction.update(buildCategoriesPanel(guild, '❌ Cette catégorie n’existe plus.'));
      }
      return interaction.showModal(
        buildCategoryModal(`admin:cat:edit:submit:${category.id}`, 'Modifier la catégorie', {
          name: category.name,
          emoji: category.emoji || '',
        }),
      );
    }

    if (action === 'toggle' && sub === 'select') {
      const result = categoriesService.toggleCategory(guild.id, selected);
      const notice = result.ok
        ? `✅ **${result.category.name}** est maintenant ${result.category.enabled ? 'active' : 'désactivée'}.`
        : `❌ ${result.error}`;
      return interaction.update(buildCategoriesPanel(guild, notice));
    }

    if (action === 'delete' && sub === 'select') {
      const result = categoriesService.deleteCategory(guild.id, selected);

      if (result.ok) {
        return interaction.update(buildCategoriesPanel(guild, `✅ Catégorie **${result.category.name}** supprimée.`));
      }

      // Catégorie encore référencée : on propose la réattribution au lieu
      // de supprimer quoi que ce soit.
      if (result.inUse) {
        const category = categoriesService.getCategory(guild.id, selected);
        if (category) return interaction.update(buildReassignView(guild, category, result.usage));
      }

      return interaction.update(buildCategoriesPanel(guild, `❌ ${result.error}`));
    }

    if (action === 'reassign' && sub === 'select') {
      const result = categoriesService.reassignCategory(guild.id, maybeId, selected);
      if (!result.ok) return interaction.update(buildCategoriesPanel(guild, `❌ ${result.error}`));

      // Réattribution faite : la suppression devient possible.
      const deletion = categoriesService.deleteCategory(guild.id, maybeId);
      const notice = deletion.ok
        ? `✅ ${result.moved} devoir(s) réattribué(s) vers **${result.to.name}**, ` +
          `catégorie **${result.from.name}** supprimée.`
        : `✅ ${result.moved} devoir(s) réattribué(s) vers **${result.to.name}**. ❌ ${deletion.error}`;

      await interaction.client.refreshDevoirBoard?.(guild.id);
      return interaction.update(buildCategoriesPanel(guild, notice));
    }

    if (action === 'order' && sub === 'select') {
      return interaction.update(buildOrderView(guild, selected));
    }
  }

  // --- Modals --------------------------------------------------------------
  if (interaction.isModalSubmit()) {
    const name = interaction.fields.getTextInputValue('name');
    const emoji = interaction.fields.getTextInputValue('emoji');

    if (action === 'add' && sub === 'submit') {
      const result = categoriesService.addCategory(guild.id, { name, emoji });
      return interaction.update(
        buildCategoriesPanel(
          guild,
          result.ok ? `✅ Catégorie **${result.category.name}** créée.` : `❌ ${result.error}`,
        ),
      );
    }

    if (action === 'edit' && sub === 'submit') {
      const result = categoriesService.updateCategory(guild.id, maybeId, { name, emoji });
      if (result.ok) {
        // Les devoirs pointent sur l'ID stable : le tableau reflète
        // immédiatement le nouveau nom sans qu'aucun devoir n'ait bougé.
        await interaction.client.refreshDevoirBoard?.(guild.id);
      }
      return interaction.update(
        buildCategoriesPanel(
          guild,
          result.ok ? `✅ Catégorie mise à jour : **${result.category.name}**.` : `❌ ${result.error}`,
        ),
      );
    }
  }

  // customId inconnu (panel expiré) : retour à la vue principale.
  return interaction.isRepliable()
    ? interaction.update(buildCategoriesPanel(guild))
    : null;
}

module.exports = { route, buildCategoriesPanel };
