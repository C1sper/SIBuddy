// events/ready.js
const { Events } = require('discord.js');
const devoirsService = require('../services/devoirsService');
const { startRemindersRunner } = require('../services/remindersRunner');
const { initDevoirBoard } = require('../services/devoir-board');
const { startRssRunner } = require('../services/rssRunner');
const { startRecurringEvents } = require('../services/recurringEvents');
const { startEventReminders } = require('../services/reminderSystem');
const { startCooldownCleanup } = require('../services/feurEngine');
const { ensureAllGuildsInitialized } = require('../services/guildLifecycle');
const { getSchemaVersion, SCHEMA_VERSION, hasLegacyData } = require('../services/guildStore');

const { createLogger } = require('../utils/logger');

const log = createLogger('bot');
let started = false;

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    log.info(`Bot connecté en tant que ${client.user.tag}!`);
    log.info(`Bot actif sur ${client.guilds.cache.size} serveur(s)`);

    client.user.setActivity('4SIB Server', { type: 3 }); // WATCHING

    // Le event Events.ClientReady peut théoriquement refeu (reconnect) selon les
    // versions de discord.js ; { once: true } le garantit déjà côté index.js,
    // mais on double-verrouille ici pour ne jamais démarrer deux fois les runners.
    if (started) return;
    started = true;

    // Prépare data/guilds/<guildId>/ pour chaque serveur connu (idempotent).
    const initialized = ensureAllGuildsInitialized(client);
    log.info(`Données prêtes pour ${initialized} serveur(s) — schéma v${getSchemaVersion()}.`);

    const schemaVersion = getSchemaVersion();
    if (schemaVersion < SCHEMA_VERSION) {
      log.warn('='.repeat(70));
      log.warn(`Schéma de données v${schemaVersion} détecté (attendu v${SCHEMA_VERSION}).`);
      if (hasLegacyData()) {
        log.warn('Des devoirs/rappels sont encore dans les anciens fichiers data/*.json');
        log.warn('et ne sont PAS visibles par le bot tant que la migration n\'a pas tourné :');
        log.warn('  node scripts/migrate-data-v2.js --dry-run');
        log.warn('  node scripts/migrate-data-v2.js --guild-id <ID>');
      }
      log.warn('='.repeat(70));
    }

    // Recalcule les rappels persistants de chaque serveur
    const { devoirsCount, createdCount } = devoirsService.rebuildAllReminders();
    log.info(`Reminders JSON rebuild: ${createdCount} rappel(s) pending créé(s) pour ${devoirsCount} élément(s).`);

    // Runner persistant (salons + DM)
    startRemindersRunner(client, { intervalMs: 30_000 });

    initDevoirBoard(client);

    const rssIntervalMs = Number(process.env.RSS_INTERVAL_MS);
    startRssRunner(client, Number.isFinite(rssIntervalMs) && rssIntervalMs > 0 ? { intervalMs: rssIntervalMs } : undefined);

    startEventReminders(client);
    startRecurringEvents(client);

    startCooldownCleanup();
  },
};
