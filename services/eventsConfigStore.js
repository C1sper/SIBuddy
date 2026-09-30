// services/eventsConfigStore.js
// Configuration du système d'événements récurrents (/event-*).
//
// Les événements d'un serveur vivent dans data/guilds/<guildId>/events.json ;
// seuls les réglages communs au bot restent globaux
// (data/global/events-settings.json).
//
// Comme pour le RSS, ce module expose la MÊME forme agrégée qu'avant la v2 —
// { events: { [guildId]: { [eventId]: event } }, reminders, settings } — pour
// que les 5 commandes /event-*, utils/eventInteractions.js et
// services/recurringEvents.js continuent de fonctionner sans modification.
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

function defaultSettings() {
  return {
    defaultReminderTimes: [
      { value: 24, unit: 'hours', label: '24h avant' },
      { value: 1, unit: 'hours', label: '1h avant' },
      { value: 15, unit: 'minutes', label: '15min avant' },
    ],
    maxEventsPerGuild: 50,
    maxParticipantsPerEvent: 100,
  };
}

function defaultConfig() {
  return { events: {}, reminders: {}, settings: defaultSettings() };
}

function readGuildEvents(guildId) {
  const raw = readGuildJson(guildId, FILES.EVENTS, { events: {} });
  const events = raw && typeof raw.events === 'object' && raw.events ? raw.events : {};
  return { ...events };
}

function writeGuildEvents(guildId, events) {
  return writeGuildJson(guildId, FILES.EVENTS, { version: 2, events: events || {} });
}

function readGlobalPart() {
  const raw = readGlobalJson(GLOBAL_FILES.EVENTS_SETTINGS, null);
  return {
    settings: { ...defaultSettings(), ...(raw?.settings && typeof raw.settings === 'object' ? raw.settings : {}) },
    reminders: raw?.reminders && typeof raw.reminders === 'object' ? raw.reminders : {},
  };
}

/** Vue agrégée, identique à l'ancien data/events-config.json. */
function readEventsConfig() {
  const { settings, reminders } = readGlobalPart();

  const events = {};
  for (const guildId of listGuildIds()) {
    const guildEvents = readGuildEvents(guildId);
    if (Object.keys(guildEvents).length > 0) events[guildId] = guildEvents;
  }

  return { events, reminders, settings };
}

/**
 * Réécrit la configuration à partir de la vue agrégée : chaque serveur reçoit
 * ses propres événements, les réglages partent dans data/global/.
 * N'écrit que ce qui a réellement changé.
 */
function writeEventsConfig(config) {
  const incoming = config && typeof config === 'object' ? config : defaultConfig();
  const incomingEvents = incoming.events && typeof incoming.events === 'object' ? incoming.events : {};

  const guildIds = new Set([...listGuildIds(), ...Object.keys(incomingEvents)]);
  for (const guildId of guildIds) {
    if (!normalizeGuildId(guildId)) continue;

    const events = incomingEvents[guildId] && typeof incomingEvents[guildId] === 'object'
      ? incomingEvents[guildId]
      : {};
    if (JSON.stringify(readGuildEvents(guildId)) === JSON.stringify(events)) continue;
    writeGuildEvents(guildId, events);
  }

  const nextGlobal = {
    version: 2,
    settings: { ...defaultSettings(), ...(incoming.settings || {}) },
    reminders: incoming.reminders && typeof incoming.reminders === 'object' ? incoming.reminders : {},
  };
  const currentGlobal = readGlobalPart();
  if (JSON.stringify({ settings: currentGlobal.settings, reminders: currentGlobal.reminders })
      !== JSON.stringify({ settings: nextGlobal.settings, reminders: nextGlobal.reminders })) {
    writeGlobalJson(GLOBAL_FILES.EVENTS_SETTINGS, nextGlobal);
  }
}

module.exports = {
  readEventsConfig,
  writeEventsConfig,
  readGuildEvents,
  writeGuildEvents,
  defaultConfig,
  defaultSettings,
};
