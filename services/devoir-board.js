// services/devoir-board.js
// Tableau des dates importantes, publié dans le salon configuré par serveur.
//
// Rendu :
//   # 📅 DATES IMPORTANTES
//
//   ## SEPTEMBRE 2026
//   - <t:1789423200:d> (soit <t:1789423200:R>) : **Cryptographie** → TP RSA
//
// Les dates et les comptes à rebours utilisent les timestamps Discord :
// l'affichage ("dans 4 jours", "demain", "dans 2 heures") se met à jour tout
// seul côté client, sans que le bot ait à réécrire le message.
const { EmbedBuilder } = require('discord.js');

const devoirsService = require('./devoirsService');
const { getDevoirsConfig, patchDevoirsConfig, isFeatureEnabled } = require('./guildConfig');
const { listGuildIds } = require('./guildStore');

const { createLogger } = require('../utils/logger');

const log = createLogger('DevoirBoard');

const BOARD_TITLE = '# 📅 DATES IMPORTANTES';
const EMPTY_MESSAGE = 'Aucune date importante à venir pour le moment.';

// Limites Discord (avec marge de sécurité)
const DESCRIPTION_MAX = 4096;
const DESCRIPTION_BUDGET = 3900;
const TOTAL_EMBED_BUDGET = 5800; // la limite dure est 6000 pour l'ensemble d'un message
const MAX_EMBEDS_PER_MESSAGE = 10;
const BOARD_COLOR = 0x5865f2;

const MONTHS_FR = [
  'JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN',
  'JUILLET', 'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE',
];

function todayKey() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Construction du texte
// ---------------------------------------------------------------------------

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * Une ligne du tableau :
 *   - <t:TS:d> (soit <t:TS:R>) : **MATIÈRE** → NOM DE LA TÂCHE
 * Sans matière renseignée (données héritées), on n'affiche que le nom.
 * L'horodatage est l'échéance réelle du devoir : son heure, ou minuit
 * par défaut (voir devoirsService.getEffectiveHeure).
 *
 * Cas particulier du jour J : un devoir reste listé jusqu'à son archivage
 * (le lendemain), même si son heure est passée. On écrit alors « aujourd'hui »
 * au lieu du compte à rebours Discord, qui afficherait « il y a 3 heures » et
 * donnerait l'impression que la ligne n'a rien à faire là.
 *
 * Ce texte est figé, mais « l'échéance tombe-t-elle aujourd'hui ? » ne change
 * pas au cours de la journée : il reste donc exact jusqu'au prochain rendu.
 */
function formatLine(devoir, now = new Date()) {
  const displayDate = devoirsService.getDisplayDate(devoir);
  if (!displayDate) return null;

  const ts = Math.floor(displayDate.getTime() / 1000);
  const titre = String(devoir.titre || 'Sans titre').trim();
  const matiere = String(devoir.matiere || '').trim();
  const subject = matiere ? `**${matiere}** → ${titre}` : `**${titre}**`;

  const relative = isSameDay(displayDate, now) ? '**aujourd’hui**' : `<t:${ts}:R>`;

  return `- <t:${ts}:d> (soit ${relative}) : ${subject}`;
}

/** Regroupe les devoirs (déjà triés chronologiquement) par année puis par mois. */
function groupByMonth(devoirs, now = new Date()) {
  const groups = [];
  let current = null;

  for (const devoir of devoirs) {
    const date = devoirsService.getDisplayDate(devoir);
    if (!date) continue;

    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!current || current.key !== key) {
      current = {
        key,
        heading: `## ${MONTHS_FR[date.getMonth()]} ${date.getFullYear()}`,
        lines: [],
      };
      groups.push(current);
    }

    const line = formatLine(devoir, now);
    if (line) current.lines.push(line);
  }

  return groups.filter(group => group.lines.length > 0);
}

/**
 * Répartit les blocs mensuels en descriptions d'embeds, sans jamais rien
 * tronquer : un mois trop volumineux est découpé sur plusieurs embeds, en
 * répétant son titre suivi de « (suite) ». L'ordre chronologique est préservé.
 */
function buildDescriptions(groups) {
  if (!groups || groups.length === 0) return [`${BOARD_TITLE}\n\n${EMPTY_MESSAGE}`];

  const descriptions = [];
  let currentDescription = BOARD_TITLE;

  const flush = () => {
    if (currentDescription.trim()) descriptions.push(currentDescription);
    currentDescription = '';
  };

  const fits = (candidate) => candidate.length <= DESCRIPTION_BUDGET;

  for (const group of groups) {
    let heading = group.heading;
    let headingWritten = false;

    for (const line of group.lines) {
      const prefix = headingWritten ? '' : `${heading}\n`;
      const separator = currentDescription ? (headingWritten ? '\n' : '\n\n') : '';
      const candidate = `${currentDescription}${separator}${prefix}${line}`;

      if (fits(candidate)) {
        currentDescription = candidate;
        headingWritten = true;
        continue;
      }

      // Ça ne rentre plus : on ferme l'embed courant et on repart sur un
      // nouveau, en réaffichant le mois pour rester lisible.
      flush();
      heading = `${group.heading} (suite)`;
      headingWritten = false;
      currentDescription = `${heading}\n${line}`;
      headingWritten = true;
    }
  }

  flush();
  return descriptions;
}

/**
 * Construit les messages du tableau. Retourne un tableau de payloads :
 * le premier est le message principal, les suivants (rares) ne sont créés
 * que si le tableau dépasse les limites Discord d'un seul message.
 */
function buildBoardMessages(devoirs, now = new Date()) {
  const groups = groupByMonth(devoirs, now);
  const descriptions = buildDescriptions(groups);

  const messages = [];
  let currentEmbeds = [];
  let currentLength = 0;

  for (const description of descriptions) {
    const length = Math.min(description.length, DESCRIPTION_MAX);
    const wouldOverflow =
      currentEmbeds.length >= MAX_EMBEDS_PER_MESSAGE ||
      (currentEmbeds.length > 0 && currentLength + length > TOTAL_EMBED_BUDGET);

    if (wouldOverflow) {
      messages.push(currentEmbeds);
      currentEmbeds = [];
      currentLength = 0;
    }

    currentEmbeds.push(new EmbedBuilder().setColor(BOARD_COLOR).setDescription(description));
    currentLength += length;
  }

  if (currentEmbeds.length > 0) messages.push(currentEmbeds);

  // Horodatage uniquement sur le dernier embed du dernier message.
  const lastMessage = messages[messages.length - 1];
  lastMessage[lastMessage.length - 1]
    .setFooter({ text: `${devoirs.length} date(s) à venir — mise à jour automatique` })
    .setTimestamp();

  return messages.map(embeds => ({ embeds }));
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

/**
 * Réutilise un message existant quand c'est possible (édition) plutôt que d'en
 * poster un nouveau à chaque actualisation.
 */
/** Descriptions des embeds d'un message, pour comparer deux rendus. */
function describe(source) {
  return (source || []).map(embed => (embed.data ? embed.data.description : embed.description) || '');
}

async function upsertMessage(channel, messageId, payload) {
  if (messageId) {
    const existing = await channel.messages.fetch(messageId).catch(() => null);
    if (existing && existing.editable) {
      // Le tableau est vérifié toutes les heures : inutile d'appeler l'API
      // Discord si le rendu n'a pas bougé. On ne compare que les descriptions,
      // le pied de page portant un horodatage qui change à chaque construction.
      const sameContent =
        JSON.stringify(describe(existing.embeds)) === JSON.stringify(describe(payload.embeds));
      if (sameContent) return existing.id;

      const edited = await existing.edit(payload).catch(() => null);
      if (edited) return edited.id;
    }
  }

  const sent = await channel.send(payload).catch(error => {
    log.error('Envoi impossible:', error.message);
    return null;
  });
  return sent ? sent.id : null;
}

/** Met à jour le tableau d'un serveur. Retourne true si le tableau a été publié. */
async function updateGuildBoard(client, guildId) {
  const cfg = getDevoirsConfig(guildId);
  if (!cfg.boardChannelId) return false;
  if (!isFeatureEnabled(guildId, 'homework')) return false;

  const channel = await client.channels.fetch(cfg.boardChannelId).catch(() => null);
  if (!channel || typeof channel.send !== 'function') {
    log.warn(`Salon du tableau inaccessible pour la guild ${guildId}.`);
    return false;
  }

  const moved = devoirsService.movePastDevoirsToArchive(guildId);
  if (moved > 0) {
    log.info(`${moved} élément(s) archivé(s) avant la mise à jour du tableau.`);
  }

  const messages = buildBoardMessages(devoirsService.getUpcoming(guildId));

  const mainMessageId = await upsertMessage(channel, cfg.boardMessageId, messages[0]);

  // Messages de débordement : on réutilise les anciens un à un, puis on
  // supprime ceux qui ne servent plus.
  const previousExtras = Array.isArray(cfg.boardExtraMessageIds) ? cfg.boardExtraMessageIds : [];
  const nextExtras = [];

  for (let i = 1; i < messages.length; i++) {
    const id = await upsertMessage(channel, previousExtras[i - 1] || null, messages[i]);
    if (id) nextExtras.push(id);
  }

  for (const staleId of previousExtras.slice(messages.length - 1)) {
    await channel.messages
      .fetch(staleId)
      .then(msg => msg.delete())
      .catch(() => null);
  }

  patchDevoirsConfig(guildId, {
    ...cfg,
    boardMessageId: mainMessageId,
    boardExtraMessageIds: nextExtras,
    boardLastUpdate: todayKey(),
  });

  return Boolean(mainMessageId);
}

/**
 * Passe en revue le tableau de tous les serveurs configurés.
 * Le rendu est reconstruit à chaque passage, mais `upsertMessage` n'édite le
 * message que si le texte a réellement changé : le contrôle horaire ne coûte
 * donc rien tant que rien ne bouge. C'est ce qui garantit que la mention
 * « aujourd'hui » apparaît au plus tard une heure après minuit.
 */
async function updateAllBoards(client) {
  for (const guildId of listGuildIds()) {
    const cfg = getDevoirsConfig(guildId);
    if (!cfg.boardChannelId) continue;

    await updateGuildBoard(client, guildId).catch(e => {
      log.error(`Erreur de mise à jour pour la guild ${guildId}:`, e.message);
    });
  }
}

/** Initialise le système du tableau et expose les déclencheurs d'actualisation. */
function initDevoirBoard(client) {
  updateAllBoards(client).catch(() => null);

  const timer = setInterval(() => {
    updateAllBoards(client).catch(() => null);
  }, 60 * 60 * 1000);
  timer.unref?.();

  // Actualisation ciblée d'un seul serveur (après ajout/modif/suppression).
  client.refreshDevoirBoard = (guildId) =>
    updateGuildBoard(client, guildId).catch(e => {
      log.error(`Actualisation ciblée échouée (${guildId}):`, e.message);
      return false;
    });

  // Actualisation globale (conservée : utilisée par /devoir-salon-liste).
  client.forceDevoirBoardUpdate = () => updateAllBoards(client);
}

module.exports = {
  BOARD_TITLE,
  EMPTY_MESSAGE,
  MONTHS_FR,
  formatLine,
  groupByMonth,
  buildDescriptions,
  buildBoardMessages,
  initDevoirBoard,
  updateGuildBoard,
  updateAllBoards,
};
