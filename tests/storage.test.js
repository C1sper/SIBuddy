// tests/storage.test.js — couche de stockage multi-serveur
const { useIsolatedDataDir, GUILD_A, GUILD_B } = require('./helpers/isolatedData');
const DATA_DIR = useIsolatedDataDir();

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guildStore = require('../services/guildStore');
const statsStore = require('../services/statsStore');

test('un guildId doit être un snowflake Discord valide', () => {
  assert.equal(guildStore.isValidGuildId(GUILD_A), true);
  assert.equal(guildStore.isValidGuildId('12345'), false, 'trop court');
  assert.equal(guildStore.isValidGuildId('abcdefghijklmnopqr'), false, 'non numérique');
  assert.equal(guildStore.isValidGuildId(''), false);
  assert.equal(guildStore.isValidGuildId(null), false);
});

test('un chemin arbitraire ne peut jamais sortir de data/guilds/', () => {
  const attaques = ['../../../etc/passwd', '..', '.', '/etc/passwd', 'guilds/../..', '~'];

  for (const attaque of attaques) {
    assert.equal(guildStore.getGuildDataPath(attaque, 'config.json'), null, attaque);
    assert.equal(guildStore.writeGuildJson(attaque, 'config.json', { pwned: true }), false, attaque);
    assert.deepEqual(guildStore.readGuildJson(attaque, 'config.json', { ok: 1 }), { ok: 1 }, attaque);
  }

  // Rien n'a été écrit hors de l'arborescence attendue.
  const guilds = guildStore.listGuildIds();
  assert.deepEqual(guilds, [], 'aucun dossier de serveur ne devait être créé');
});

test('ajouter une donnée dans le serveur A ne modifie jamais le serveur B', () => {
  guildStore.writeGuildJson(GUILD_A, guildStore.FILES.DEVOIRS, [{ id: 'a1', titre: 'Devoir A' }]);
  guildStore.writeGuildJson(GUILD_B, guildStore.FILES.DEVOIRS, [{ id: 'b1', titre: 'Devoir B' }]);

  guildStore.writeGuildJson(GUILD_A, guildStore.FILES.DEVOIRS, [
    { id: 'a1', titre: 'Devoir A' },
    { id: 'a2', titre: 'Devoir A2' },
  ]);

  const a = guildStore.readGuildJson(GUILD_A, guildStore.FILES.DEVOIRS, []);
  const b = guildStore.readGuildJson(GUILD_B, guildStore.FILES.DEVOIRS, []);

  assert.equal(a.length, 2);
  assert.equal(b.length, 1);
  assert.equal(b[0].titre, 'Devoir B');
});

test('listGuildIds ignore les dossiers qui ne sont pas des snowflakes', () => {
  fs.mkdirSync(path.join(DATA_DIR, 'guilds', 'pas-un-id'), { recursive: true });

  const ids = guildStore.listGuildIds().sort();
  assert.deepEqual(ids, [GUILD_A, GUILD_B].sort());
});

test('un JSON corrompu est mis en quarantaine, jamais écrasé en silence', () => {
  const filePath = guildStore.getGuildDataPath(GUILD_A, guildStore.FILES.CATEGORIES);
  fs.writeFileSync(filePath, '{ ceci n est pas du JSON', 'utf-8');

  const result = guildStore.readGuildJson(GUILD_A, guildStore.FILES.CATEGORIES, { categories: [] });
  assert.deepEqual(result, { categories: [] }, 'valeurs par défaut retournées');

  const quarantined = fs
    .readdirSync(guildStore.getGuildDataPath(GUILD_A))
    .filter(f => f.includes('.corrupt-'));

  assert.equal(quarantined.length, 1, 'le fichier illisible doit être conservé');
  assert.match(fs.readFileSync(path.join(guildStore.getGuildDataPath(GUILD_A), quarantined[0]), 'utf-8'), /ceci n est pas du JSON/);
});

test('les statistiques sont cloisonnées par serveur', () => {
  statsStore.incrementMessageCount(GUILD_A, '300000000000000003');
  statsStore.incrementMessageCount(GUILD_A, '300000000000000003');
  statsStore.incrementMessageCount(GUILD_B, '400000000000000004');

  assert.equal(statsStore.getMessageCount(GUILD_A, '300000000000000003'), 2);
  assert.equal(statsStore.getMessageCount(GUILD_B, '300000000000000003'), 0, 'aucune fuite de A vers B');
  assert.equal(statsStore.getMessageCount(GUILD_A, '400000000000000004'), 0, 'aucune fuite de B vers A');

  assert.deepEqual(statsStore.getTopUsers(GUILD_B, 5), [['400000000000000004', 1]]);
});

test('la version du schéma est lisible et évolutive', () => {
  assert.equal(guildStore.getSchemaVersion(), 1, 'installation neuve = v1 par défaut');
  guildStore.ensureSchemaVersion();
  assert.equal(guildStore.getSchemaVersion(), guildStore.SCHEMA_VERSION);
});
