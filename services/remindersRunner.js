// services/remindersRunner.js
// Envoie les rappels persistants arrivés à échéance (salon + DM).
// Chaque rappel porte son guildId : la configuration (rôle mentionné, salon
// de rappels) et la catégorie sont toujours résolues sur le bon serveur.
const { EmbedBuilder } = require('discord.js');

const { getPendingDue, markSent, cleanupOldSent } = require('./remindersStore');
const { getDevoirsConfig, isFeatureEnabled } = require('./guildConfig');
const categoriesService = require('./categoriesService');
const devoirsService = require('./devoirsService');

const { createLogger } = require('../utils/logger');

const log = createLogger('remindersRunner');
const { IMPORTANCE_LABELS } = devoirsService;

/** Libellé de catégorie du rappel, résolu au moment de l'envoi. */
function resolveCategoryLabel(reminder) {
  const category =
    categoriesService.getCategory(reminder.guildId, reminder.categoryId) ||
    categoriesService.resolveCategory(reminder.guildId, reminder.type);
  return category ? categoriesService.formatCategory(category) : 'Devoir';
}

/** "Cryptographie → TP RSA" ou "TP RSA" si aucune matière. */
function formatSubject(reminder) {
  const titre = reminder.title || 'Sans titre';
  return reminder.matiere ? `**${reminder.matiere}** → ${titre}` : `**${titre}**`;
}

function buildMention(cfg) {
  return cfg.roleId ? `<@&${cfg.roleId}>` : '@everyone';
}

function buildAllowedMentions(cfg) {
  if (cfg.roleId) return { roles: [cfg.roleId], parse: [] };
  return { parse: ['everyone'] };
}

function getReminderColor(importance, kind) {
  const imp = importance || 'important';
  let color = imp === 'tres_important' ? 0xe74c3c : imp === 'faible' ? 0x95a5a6 : 0xf39c12;
  if (kind === '7d' && imp !== 'tres_important') color = 0xf1c40f;
  return color;
}

function buildDescription(reminder) {
  const subject = formatSubject(reminder);
  const echeance = devoirsService.formatEcheance(reminder);

  if (reminder.kind === '7d') {
    return `${subject} est à rendre dans **7 jours** (le ${echeance}).`;
  }
  if (reminder.kind === '1d-morning' || reminder.kind === '1d-evening') {
    return `${subject} est à rendre **demain** (${echeance}).`;
  }
  return `Rappel pour ${subject} (échéance le ${echeance}).`;
}

/**
 * Salon cible :
 * - le salon de rappels configuré pour le serveur s'il existe,
 * - sinon le salon d'origine du devoir,
 * - sinon `channelId` (compatibilité avec les tout premiers rappels).
 */
function resolveTargetChannelId(cfg, reminder) {
  return cfg.reminderChannelId || reminder.sourceChannelId || reminder.channelId || null;
}

function buildDMEmbed(reminder) {
  const echeance = devoirsService.formatEcheance(reminder);

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`🔔 Rappel (DM) — ${resolveCategoryLabel(reminder)}`)
    .setDescription(
      'Tu m’avais demandé un rappel pour :\n\n' +
      `📘 ${formatSubject(reminder)}\n📅 ${echeance}\n📝 ${reminder.description || 'Aucune'}`,
    )
    .addFields({
      name: '📍 Importance',
      value: IMPORTANCE_LABELS[reminder.importance || 'important'] || 'Important',
      inline: true,
    })
    .setTimestamp();
}

async function deliverDM(client, reminder) {
  if (!reminder.userId) {
    log.warn(`Rappel DM sans userId (id=${reminder.id})`);
    return;
  }

  const user = await client.users.fetch(reminder.userId).catch(() => null);
  if (!user) {
    log.warn(`Utilisateur introuvable (${reminder.userId}) pour le rappel DM ${reminder.id}`);
    return;
  }

  await user.send({ embeds: [buildDMEmbed(reminder)] });
  log.info(`Rappel DM (${reminder.kind}) envoyé à ${user.tag} pour ${reminder.title}`);
}

async function deliverChannel(client, reminder) {
  const cfg = getDevoirsConfig(reminder.guildId);
  const targetChannelId = resolveTargetChannelId(cfg, reminder);

  if (!targetChannelId) {
    log.warn(`Rappel sans salon cible (guild=${reminder.guildId}, id=${reminder.id})`);
    return;
  }

  const channel = await client.channels.fetch(targetChannelId).catch(() => null);
  if (!channel || typeof channel.send !== 'function') {
    log.warn(`Salon introuvable (${targetChannelId}) pour le rappel ${reminder.id}`);
    return;
  }

  const importance = reminder.importance || 'important';
  const echeance = devoirsService.formatEcheance(reminder);

  const embed = new EmbedBuilder()
    .setColor(getReminderColor(importance, reminder.kind))
    .setTitle(`📢 Rappel — ${resolveCategoryLabel(reminder)}`)
    .setDescription(buildDescription(reminder))
    .addFields(
      { name: '📘 Intitulé', value: `${reminder.matiere ? `${reminder.matiere} — ` : ''}${reminder.title || 'Sans titre'}` },
      { name: '📅 Date limite', value: echeance, inline: true },
      { name: '📍 Importance', value: IMPORTANCE_LABELS[importance] || 'Important', inline: true },
      { name: '📝 Description', value: reminder.description || 'Aucune' },
    )
    .setTimestamp();

  await channel.send({
    content: buildMention(cfg),
    embeds: [embed],
    allowedMentions: buildAllowedMentions(cfg),
  });

  log.info(`Rappel (${reminder.kind}) envoyé pour ${reminder.title} dans #${targetChannelId}`);
}

function startRemindersRunner(client, { intervalMs = 30_000 } = {}) {
  log.info(`RemindersRunner démarré (interval ${intervalMs}ms)`);

  setInterval(() => {
    try {
      cleanupOldSent(30);
    } catch (e) {
      log.error('cleanupOldSent error:', e.message);
    }
  }, 6 * 60 * 60 * 1000);

  setInterval(async () => {
    try {
      const due = getPendingDue(Date.now());
      if (due.length === 0) return;

      for (const reminder of due) {
        // Rappels suspendus si les devoirs sont désactivés sur ce serveur :
        // ils restent "pending" et repartiront à la réactivation.
        if (!isFeatureEnabled(reminder.guildId, 'homework')) continue;

        try {
          if (reminder.delivery === 'dm') {
            await deliverDM(client, reminder);
          } else {
            await deliverChannel(client, reminder);
          }
        } catch (e) {
          // On marque quand même comme envoyé pour ne pas boucler indéfiniment
          // (salon supprimé, DM fermés, permissions retirées...).
          log.error(`Erreur d'envoi du rappel ${reminder.id}:`, e.message);
        }

        markSent(reminder.guildId, reminder.id);
      }
    } catch (err) {
      log.error('RemindersRunner error:', err);
    }
  }, intervalMs);
}

module.exports = { startRemindersRunner, buildDescription, formatSubject };
