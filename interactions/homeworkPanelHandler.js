// interactions/homeworkPanelHandler.js
// Sous-panel "Devoirs" du panel d'administration (customId préfixés "admin:hw:").
//
// Affichage, ajout, MODIFICATION COMPLÈTE, suppression et timings personnalisés.
// Tout passe par services/devoirsService.js — exactement les mêmes fonctions
// que les commandes slash, aucune logique n'est dupliquée ici.
//
// Les customId ne contiennent que des identifiants stables (ID de devoir,
// ID de catégorie), jamais de texte saisi par un utilisateur.
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const devoirsService = require('../services/devoirsService');
const categoriesService = require('../services/categoriesService');

const { IMPORTANCE_LABELS } = devoirsService;
const MAX_LIST = 25; // borne d'un select menu Discord

// ---------------------------------------------------------------------------
// Helpers d'affichage
// ---------------------------------------------------------------------------

function formatSubject(devoir) {
  return devoir.matiere ? `**${devoir.matiere}** → ${devoir.titre}` : `**${devoir.titre}**`;
}

function formatEcheance(devoir) {
  return devoirsService.formatEcheance(devoir);
}

function categoryLabel(guildId, devoir) {
  return categoriesService.formatCategory(devoirsService.getDevoirCategory(guildId, devoir));
}

/** Charge un devoir du serveur courant, ou null s'il a disparu entre-temps. */
function findDevoir(guildId, devoirId) {
  return devoirsService.readDevoirs(guildId).find(d => devoirsService.sameId(d.id, devoirId)) || null;
}

function notFoundView(message = '❌ Ce devoir n’existe plus.') {
  return {
    embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription(message)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin:hw:open').setLabel('Retour').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Vue principale
// ---------------------------------------------------------------------------

function buildHomeworkPanel(guild, notice = null) {
  const guildId = guild.id;
  const upcoming = devoirsService.getUpcoming(guildId);
  const categories = categoriesService.listCategories(guildId);
  const activeCategories = categories.filter(c => c.enabled);
  const boardCfg = devoirsService.getGuildConfig(guildId);

  // Répartition calculée dynamiquement : aucune catégorie n'est codée en dur.
  const counts = new Map(categories.map(c => [c.id, 0]));
  let uncategorized = 0;
  for (const devoir of upcoming) {
    const category = devoirsService.getDevoirCategory(guildId, devoir);
    if (category && counts.has(category.id)) counts.set(category.id, counts.get(category.id) + 1);
    else uncategorized++;
  }

  const breakdown = categories
    .filter(c => counts.get(c.id) > 0)
    .map(c => `${categoriesService.formatCategory(c)} : **${counts.get(c.id)}**`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📚 Gestion des dates importantes')
    .setDescription(
      (notice ? `${notice}\n\n` : '') +
      `**${upcoming.length}** date(s) à venir — **${activeCategories.length}** catégorie(s) active(s)\n\n` +
      (breakdown || '_Aucune date à venir pour le moment._') +
      (uncategorized > 0 ? `\n⚠️ Sans catégorie valide : **${uncategorized}**` : ''),
    )
    .addFields(
      {
        name: '📊 Salon du tableau',
        value: boardCfg.boardChannelId ? `<#${boardCfg.boardChannelId}>` : 'non configuré (`/devoir-salon-liste`)',
        inline: true,
      },
      {
        name: '📣 Salon des rappels',
        value: boardCfg.reminderChannelId ? `<#${boardCfg.reminderChannelId}>` : 'salon d’origine de chaque devoir',
        inline: true,
      },
    )
    .setTimestamp();

  const hasItems = upcoming.length > 0;

  const rowActions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:hw:list').setLabel('Afficher').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:hw:add').setLabel('Ajouter').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('admin:hw:edit:menu').setLabel('Modifier').setEmoji('✏️').setStyle(ButtonStyle.Primary)
      .setDisabled(!hasItems),
    new ButtonBuilder().setCustomId('admin:hw:delete:menu').setLabel('Supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
      .setDisabled(!hasItems),
  );

  const rowNav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:hw:timings:menu').setLabel('Timings').setEmoji('⏱️').setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasItems),
    new ButtonBuilder().setCustomId('admin:hw:refresh').setLabel('Actualiser le tableau').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:home').setLabel('Retour').setEmoji('◀️').setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [rowActions, rowNav] };
}

function buildDevoirsListView(guild) {
  const guildId = guild.id;
  const devoirs = devoirsService.getUpcoming(guildId).slice(0, 20);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📋 Dates importantes à venir')
    .setDescription(
      devoirs.length === 0
        ? '📭 Aucun élément pour le moment.'
        : devoirs
            .map((d, i) =>
              `**${i + 1}.** ${formatSubject(d)}\n` +
              `🗂️ ${categoryLabel(guildId, d)} — 📅 ${formatEcheance(d)} — ` +
              `📍 ${IMPORTANCE_LABELS[d.importance] || 'Important'}`,
            )
            .join('\n\n'),
    )
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin:hw:open').setLabel('Retour').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

/** Select menu listant les devoirs à venir du serveur. */
function buildDevoirSelectMenu(guild, customId, placeholder) {
  const guildId = guild.id;
  const devoirs = devoirsService.getUpcoming(guildId).slice(0, MAX_LIST);

  if (devoirs.length === 0) return notFoundView('📭 Aucune date à venir sur ce serveur.');

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder.slice(0, 150))
    .addOptions(
      devoirs.map(d => ({
        label: (d.matiere ? `${d.matiere} — ${d.titre}` : d.titre).slice(0, 100),
        description: `${categoryLabel(guildId, d)} — ${formatEcheance(d)}`.slice(0, 100),
        value: String(d.id),
      })),
    );

  return {
    embeds: [new EmbedBuilder().setColor(0x3498db).setDescription(placeholder)],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin:hw:open').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Ajout
// ---------------------------------------------------------------------------

function buildAddDevoirModal(guild) {
  const fallback = categoriesService.getFallbackCategory(guild.id);

  const modal = new ModalBuilder().setCustomId('admin:hw:add:submit').setTitle('Ajouter une date importante');

  const fields = [
    new TextInputBuilder().setCustomId('matiere').setLabel('Matière (ex : Cryptographie)')
      .setStyle(TextInputStyle.Short).setMaxLength(devoirsService.MATIERE_MAX_LENGTH).setRequired(false),
    new TextInputBuilder().setCustomId('titre').setLabel('Nom de la tâche (ex : TP RSA)')
      .setStyle(TextInputStyle.Short).setMaxLength(devoirsService.TITRE_MAX_LENGTH).setRequired(true),
    new TextInputBuilder().setCustomId('date').setLabel('Date limite (AAAA-MM-JJ [HH:mm])')
      .setPlaceholder('2026-09-12  ou  2026-09-12 14:30 — sans heure : minuit')
      .setStyle(TextInputStyle.Short).setRequired(true),
    new TextInputBuilder().setCustomId('categorie').setLabel('Catégorie (nom exact)')
      .setPlaceholder(fallback ? fallback.name : 'Devoir')
      .setValue(fallback ? fallback.name : '')
      .setStyle(TextInputStyle.Short).setRequired(true),
    new TextInputBuilder().setCustomId('description').setLabel('Description (facultatif)')
      .setStyle(TextInputStyle.Paragraph).setMaxLength(devoirsService.DESCRIPTION_MAX_LENGTH).setRequired(false),
  ];

  modal.addComponents(...fields.map(f => new ActionRowBuilder().addComponents(f)));
  return modal;
}

// ---------------------------------------------------------------------------
// Modification complète
// ---------------------------------------------------------------------------

/** Fiche d'édition d'un devoir : champs texte, catégorie, importance, timings. */
function buildEditView(guild, devoirId, notice = null) {
  const guildId = guild.id;
  const devoir = findDevoir(guildId, devoirId);
  if (!devoir) return notFoundView();

  const category = devoirsService.getDevoirCategory(guildId, devoir);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('✏️ Modifier une date importante')
    .setDescription((notice ? `${notice}\n\n` : '') + formatSubject(devoir))
    .addFields(
      { name: '📗 Matière', value: devoir.matiere || '—', inline: true },
      { name: '📅 Échéance', value: formatEcheance(devoir), inline: true },
      { name: '🗂️ Catégorie', value: categoriesService.formatCategory(category), inline: true },
      { name: '📍 Importance', value: IMPORTANCE_LABELS[devoir.importance] || 'Important', inline: true },
      { name: '⏱️ Timings perso.', value: String((devoir.customTimings || []).length), inline: true },
      { name: '📝 Description', value: devoir.description || 'Aucune' },
    )
    .setTimestamp();

  // Catégories : on inclut celle du devoir même si elle est désactivée,
  // pour ne pas la faire disparaître de la fiche.
  const categories = categoriesService
    .listCategories(guildId)
    .filter(c => c.enabled || c.id === devoir.categoryId)
    .slice(0, MAX_LIST);

  const categorySelect = new StringSelectMenuBuilder()
    .setCustomId(`admin:hw:edit:cat:${devoir.id}`)
    .setPlaceholder('Changer la catégorie...')
    .addOptions(
      categories.map(c => ({
        label: c.name.slice(0, 100),
        description: c.enabled ? 'Active' : 'Désactivée',
        value: c.id,
        default: c.id === devoir.categoryId,
        ...(c.emoji && !c.emoji.startsWith('<') ? { emoji: c.emoji } : {}),
      })),
    );

  const importanceSelect = new StringSelectMenuBuilder()
    .setCustomId(`admin:hw:edit:imp:${devoir.id}`)
    .setPlaceholder('Changer l’importance...')
    .addOptions(
      Object.entries(IMPORTANCE_LABELS).map(([value, label]) => ({
        label,
        value,
        default: value === devoir.importance,
      })),
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(categorySelect),
      new ActionRowBuilder().addComponents(importanceSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`admin:hw:edit:fields:${devoir.id}`).setLabel('Matière / nom / date')
          .setEmoji('✏️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`admin:hw:timings:select:${devoir.id}`).setLabel('Timings')
          .setEmoji('⏱️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('admin:hw:open').setLabel('Retour').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildEditFieldsModal(devoir) {
  const modal = new ModalBuilder()
    .setCustomId(`admin:hw:edit:submit:${devoir.id}`)
    .setTitle('Modifier les informations');

  const fields = [
    new TextInputBuilder().setCustomId('matiere').setLabel('Matière')
      .setStyle(TextInputStyle.Short).setMaxLength(devoirsService.MATIERE_MAX_LENGTH)
      .setValue(devoir.matiere || '').setRequired(false),
    new TextInputBuilder().setCustomId('titre').setLabel('Nom de la tâche')
      .setStyle(TextInputStyle.Short).setMaxLength(devoirsService.TITRE_MAX_LENGTH)
      .setValue(devoir.titre || '').setRequired(true),
    new TextInputBuilder().setCustomId('date').setLabel('Date limite (AAAA-MM-JJ)')
      .setStyle(TextInputStyle.Short).setValue(devoir.date || '').setRequired(true),
    new TextInputBuilder().setCustomId('heure').setLabel('Heure limite (HH:mm, vide = minuit)')
      .setStyle(TextInputStyle.Short).setValue(devoir.heure || '').setRequired(false),
    new TextInputBuilder().setCustomId('description').setLabel('Description')
      .setStyle(TextInputStyle.Paragraph).setMaxLength(devoirsService.DESCRIPTION_MAX_LENGTH)
      .setValue(devoir.description || '').setRequired(false),
  ];

  modal.addComponents(...fields.map(f => new ActionRowBuilder().addComponents(f)));
  return modal;
}

// ---------------------------------------------------------------------------
// Timings
// ---------------------------------------------------------------------------

function buildTimingsView(guild, devoirId) {
  const devoir = findDevoir(guild.id, devoirId);
  if (!devoir) return notFoundView();

  const timings = Array.isArray(devoir.customTimings) ? devoir.customTimings : [];

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`⏱️ Timings — ${devoir.titre}`)
    .setDescription(
      timings.length === 0
        ? '_Aucun timing personnalisé pour cet élément._'
        : timings
            .map((t, i) => `**${i + 1}.** ${t.label} (${devoirsService.formatDuration(t.offsetMs)} avant l’échéance)`)
            .join('\n'),
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`admin:hw:timings:add:${devoir.id}`).setLabel('Ajouter').setEmoji('➕').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`admin:hw:timings:remove:menu:${devoir.id}`).setLabel('Supprimer').setEmoji('🗑️')
          .setStyle(ButtonStyle.Danger).setDisabled(timings.length === 0),
        new ButtonBuilder().setCustomId(`admin:hw:edit:view:${devoir.id}`).setLabel('Retour').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildTimingModal(devoirId) {
  const modal = new ModalBuilder().setCustomId(`admin:hw:timings:add:submit:${devoirId}`).setTitle('Ajouter un timing');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('label').setLabel('Libellé (ex : "3 jours avant")')
        .setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('delai').setLabel('Délai avant échéance (ex : 3j, 12h, 45m)')
        .setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(true),
    ),
  );
  return modal;
}

function buildTimingRemoveMenu(guild, devoirId) {
  const devoir = findDevoir(guild.id, devoirId);
  if (!devoir) return notFoundView();

  const timings = Array.isArray(devoir.customTimings) ? devoir.customTimings : [];
  if (timings.length === 0) return buildTimingsView(guild, devoirId);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`admin:hw:timings:remove:select:${devoir.id}`)
    .setPlaceholder('Choisis un timing à supprimer...')
    .addOptions(
      timings.slice(0, MAX_LIST).map((t, i) => ({
        label: String(t.label).slice(0, 100),
        description: devoirsService.formatDuration(t.offsetMs),
        value: String(i),
      })),
    );

  return {
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`admin:hw:timings:select:${devoir.id}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Actualisation du tableau
// ---------------------------------------------------------------------------

async function refreshBoard(interaction) {
  await interaction.client.refreshDevoirBoard?.(interaction.guildId);
}

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------

async function route(interaction, parts) {
  const guild = interaction.guild;
  const guildId = guild.id;
  const [action, sub, subSub, maybeId] = parts;

  // --- Boutons -------------------------------------------------------------
  if (interaction.isButton()) {
    if (action === 'open') return interaction.update(buildHomeworkPanel(guild));
    if (action === 'list') return interaction.update(buildDevoirsListView(guild));
    if (action === 'add') return interaction.showModal(buildAddDevoirModal(guild));

    if (action === 'edit' && sub === 'menu') {
      return interaction.update(buildDevoirSelectMenu(guild, 'admin:hw:edit:select', 'Choisis l’élément à modifier...'));
    }

    if (action === 'edit' && sub === 'view') {
      return interaction.update(buildEditView(guild, subSub));
    }

    if (action === 'edit' && sub === 'fields') {
      const devoir = findDevoir(guildId, subSub);
      if (!devoir) return interaction.update(notFoundView());
      return interaction.showModal(buildEditFieldsModal(devoir));
    }

    if (action === 'delete' && sub === 'menu') {
      return interaction.update(buildDevoirSelectMenu(guild, 'admin:hw:delete:select', 'Choisis l’élément à supprimer...'));
    }

    if (action === 'timings' && sub === 'menu') {
      return interaction.update(buildDevoirSelectMenu(guild, 'admin:hw:timings:select', 'Choisis un élément...'));
    }

    if (action === 'timings' && sub === 'select') {
      return interaction.update(buildTimingsView(guild, subSub));
    }

    if (action === 'timings' && sub === 'add') {
      if (!findDevoir(guildId, subSub)) return interaction.update(notFoundView());
      return interaction.showModal(buildTimingModal(subSub));
    }

    if (action === 'timings' && sub === 'remove' && subSub === 'menu') {
      return interaction.update(buildTimingRemoveMenu(guild, maybeId));
    }

    if (action === 'refresh') {
      await refreshBoard(interaction);
      return interaction.update(buildHomeworkPanel(guild, '🔄 Tableau actualisé.'));
    }
  }

  // --- Menus de sélection --------------------------------------------------
  if (interaction.isStringSelectMenu()) {
    const selected = interaction.values?.[0];

    if (action === 'edit' && sub === 'select') {
      return interaction.update(buildEditView(guild, selected));
    }

    if (action === 'edit' && sub === 'cat') {
      const result = devoirsService.updateDevoir(guildId, subSub, { categoryRef: selected });
      if (result.ok) await refreshBoard(interaction);
      return interaction.update(
        buildEditView(guild, subSub, result.ok ? '✅ Catégorie mise à jour.' : `❌ ${result.error}`),
      );
    }

    if (action === 'edit' && sub === 'imp') {
      const result = devoirsService.updateDevoir(guildId, subSub, { importance: selected });
      if (result.ok) await refreshBoard(interaction);
      return interaction.update(
        buildEditView(guild, subSub, result.ok ? '✅ Importance mise à jour.' : `❌ ${result.error}`),
      );
    }

    if (action === 'delete' && sub === 'select') {
      const result = devoirsService.deleteDevoir(guildId, selected);
      if (result.ok) await refreshBoard(interaction);
      return interaction.update(
        buildHomeworkPanel(
          guild,
          result.ok
            ? `🗑️ **${result.devoir.titre}** supprimé (${result.cancelledCount} rappel(s) annulé(s)).`
            : `❌ ${result.error}`,
        ),
      );
    }

    if (action === 'timings' && sub === 'select') {
      return interaction.update(buildTimingsView(guild, selected));
    }

    if (action === 'timings' && sub === 'remove' && subSub === 'select') {
      const result = devoirsService.removeCustomTiming(guildId, maybeId, Number(selected));
      if (result.ok) await refreshBoard(interaction);
      return interaction.update(buildTimingsView(guild, maybeId));
    }
  }

  // --- Modals --------------------------------------------------------------
  if (interaction.isModalSubmit()) {
    if (action === 'add' && sub === 'submit') {
      // Un modal Discord est limité à 5 champs : la date porte donc aussi
      // l'heure facultative ("2026-09-12 14:30").
      const saisie = devoirsService.parseDateTimeInput(interaction.fields.getTextInputValue('date'));

      const result = devoirsService.addDevoir({
        guildId,
        channelId: interaction.channelId,
        matiere: interaction.fields.getTextInputValue('matiere'),
        titre: interaction.fields.getTextInputValue('titre'),
        date: saisie.date,
        heure: saisie.heure,
        categoryRef: interaction.fields.getTextInputValue('categorie'),
        description: interaction.fields.getTextInputValue('description'),
        importance: 'important',
        timingsStr: '',
      });

      if (result.ok) await refreshBoard(interaction);
      return interaction.update(
        buildHomeworkPanel(
          guild,
          result.ok ? `✅ **${result.devoir.titre}** ajouté.` : `❌ ${result.error}`,
        ),
      );
    }

    if (action === 'edit' && sub === 'submit') {
      const result = devoirsService.updateDevoir(guildId, subSub, {
        matiere: interaction.fields.getTextInputValue('matiere'),
        titre: interaction.fields.getTextInputValue('titre'),
        date: interaction.fields.getTextInputValue('date'),
        heure: interaction.fields.getTextInputValue('heure'),
        description: interaction.fields.getTextInputValue('description'),
      });

      if (result.ok) await refreshBoard(interaction);
      return interaction.update(
        buildEditView(
          guild,
          subSub,
          result.ok
            ? `✅ Modifications enregistrées (${result.reminders.length} rappel(s) reprogrammé(s)).`
            : `❌ ${result.error}`,
        ),
      );
    }

    if (action === 'timings' && sub === 'add' && subSub === 'submit') {
      const result = devoirsService.addCustomTiming(
        guildId,
        maybeId,
        interaction.fields.getTextInputValue('label'),
        interaction.fields.getTextInputValue('delai'),
      );

      if (!result.ok) {
        return interaction.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
      }
      return interaction.update(buildTimingsView(guild, maybeId));
    }
  }

  // customId inconnu (panel expiré) : retour à la vue principale.
  return interaction.isRepliable() ? interaction.update(buildHomeworkPanel(guild)) : null;
}

module.exports = { route, buildHomeworkPanel, buildEditView };
