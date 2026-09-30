// services/remindersStore.js
// Rappels persistants, stockés par serveur : data/guilds/<guildId>/reminders.json
//
// Un rappel est TOUJOURS rattaché explicitement à une guild. Les rappels
// hérités sans guild rattachable atterrissent dans data/global/reminders-orphans.json
// (conservés, jamais envoyés) plutôt que d'être silencieusement perdus.
//
// Forme d'un rappel :
// {
//   id, status: 'pending'|'sent'|'cancelled', createdAt, sentAt,
//   guildId, sourceChannelId, userId?, delivery?: 'dm',
//   devoirId, categoryId, kind, title, matiere, type, importance, date, description,
//   remindAtISO
// }
const {
  FILES,
  GLOBAL_FILES,
  readGuildJson,
  writeGuildJson,
  readGlobalJson,
  writeGlobalJson,
  listGuildIds,
  normalizeGuildId,
} = require('./guildStore');
const { createLogger } = require('../utils/logger');

const log = createLogger('remindersStore');

const EMPTY = () => ({ version: 2, reminders: [] });

function makeId() {
  return `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeContainer(raw) {
  if (!raw || typeof raw !== 'object') return EMPTY();
  return {
    version: Number(raw.version) || 2,
    reminders: Array.isArray(raw.reminders) ? raw.reminders.filter(r => r && typeof r === 'object') : [],
  };
}

// ---------------------------------------------------------------------------
// Accès par serveur
// ---------------------------------------------------------------------------

function readGuildReminders(guildId) {
  return normalizeContainer(readGuildJson(guildId, FILES.REMINDERS, EMPTY()));
}

function writeGuildReminders(guildId, data) {
  return writeGuildJson(guildId, FILES.REMINDERS, normalizeContainer(data));
}

function readOrphans() {
  return normalizeContainer(readGlobalJson(GLOBAL_FILES.ORPHAN_REMINDERS, EMPTY()));
}

function writeOrphans(data) {
  return writeGlobalJson(GLOBAL_FILES.ORPHAN_REMINDERS, normalizeContainer(data));
}

function decorate(reminder) {
  return {
    id: makeId(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    sentAt: null,
    ...reminder,
  };
}

/**
 * Ajoute plusieurs rappels d'un même serveur en une seule écriture.
 * Les rappels sans guildId valide sont mis de côté dans le fichier orphelins.
 */
function addMany(guildId, reminders) {
  const list = Array.isArray(reminders) ? reminders : [];
  if (list.length === 0) return [];

  const id = normalizeGuildId(guildId);
  if (!id) {
    const orphans = readOrphans();
    const created = list.map(r => decorate({ ...r, guildId: null }));
    orphans.reminders.push(...created);
    writeOrphans(orphans);
    log.warn(`${created.length} rappel(s) sans guild valide mis en attente (orphelins).`);
    return created;
  }

  const data = readGuildReminders(id);
  const created = list.map(r => decorate({ ...r, guildId: id }));
  data.reminders.push(...created);
  writeGuildReminders(id, data);
  return created;
}

/** Ajoute un rappel unique. */
function addReminder(reminder) {
  const [created] = addMany(reminder?.guildId, [reminder]);
  return created;
}

function markSent(guildId, reminderId) {
  const id = normalizeGuildId(guildId);
  if (!id) return false;

  const data = readGuildReminders(id);
  const reminder = data.reminders.find(r => r.id === reminderId);
  if (!reminder) return false;

  reminder.status = 'sent';
  reminder.sentAt = new Date().toISOString();
  writeGuildReminders(id, data);
  return true;
}

/**
 * Annule les rappels encore en attente d'un devoir donné.
 * Le guildId est obligatoire : il garantit qu'on ne touche jamais aux
 * rappels d'un autre serveur qui porterait le même devoirId.
 */
function cancelByDevoirId(guildId, devoirId) {
  const id = normalizeGuildId(guildId);
  if (!id) return 0;

  const data = readGuildReminders(id);
  const needle = String(devoirId);
  let changed = 0;

  for (const reminder of data.reminders) {
    if (String(reminder.devoirId) === needle && reminder.status === 'pending') {
      reminder.status = 'cancelled';
      reminder.sentAt = new Date().toISOString();
      changed++;
    }
  }

  if (changed > 0) writeGuildReminders(id, data);
  return changed;
}

/** Purge les rappels envoyés/annulés plus vieux que `days` jours, sur tous les serveurs. */
function cleanupOldSent(days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const guildId of listGuildIds()) {
    const data = readGuildReminders(guildId);
    const before = data.reminders.length;

    data.reminders = data.reminders.filter(r => {
      if (r.status !== 'sent' && r.status !== 'cancelled') return true;
      const t = new Date(r.sentAt || r.createdAt || 0).getTime();
      return Number.isNaN(t) ? true : t >= cutoff;
    });

    if (data.reminders.length !== before) {
      writeGuildReminders(guildId, data);
      removed += before - data.reminders.length;
    }
  }

  return removed;
}

/**
 * Rappels arrivés à échéance, tous serveurs confondus.
 * Chaque élément porte son guildId : le runner sait toujours à qui il appartient.
 */
function getPendingDue(nowMs = Date.now()) {
  const due = [];

  for (const guildId of listGuildIds()) {
    for (const reminder of readGuildReminders(guildId).reminders) {
      if (reminder.status !== 'pending') continue;
      const t = new Date(reminder.remindAtISO).getTime();
      if (Number.isNaN(t) || t > nowMs) continue;
      due.push({ ...reminder, guildId });
    }
  }

  return due;
}

/** Tous les rappels d'un serveur (lecture pure, utilisée par les tests et la migration). */
function listByGuild(guildId) {
  return readGuildReminders(guildId).reminders;
}

module.exports = {
  readGuildReminders,
  writeGuildReminders,
  readOrphans,
  writeOrphans,
  addReminder,
  addMany,
  markSent,
  cancelByDevoirId,
  cleanupOldSent,
  getPendingDue,
  listByGuild,
};
