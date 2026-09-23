// tests/migration.test.js — script scripts/migrate-data-v2.js
//
// Le script est exécuté comme un vrai processus, avec son propre dossier
// data/ jetable : on teste ce qui sera réellement lancé en production.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'migrate-data-v2.js');
const GUILD = '100000000000000001';
const OTHER_GUILD = '200000000000000002';

const tempDirs = [];
process.on('exit', () => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* déjà nettoyé */ }
  }
});

/** Crée un dossier data/ v1 réaliste (avec des archives sans guildId). */
function makeLegacyData({ withOrphans = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-mig-'));
  tempDirs.push(root);

  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const write = (name, value) => fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value, null, 2));

  write('devoirs.json', [
    { id: 1764094551334, guildId: GUILD, channelId: '900000000000000009', titre: 'TP RSA', date: '2099-09-12', description: 'a', type: 'examen', importance: 'tres_important', customTimings: [] },
    { id: 1764094551335, guildId: GUILD, channelId: '900000000000000009', titre: 'Projet IPS', date: '2099-09-15', description: 'b', type: 'projet', importance: 'important', customTimings: [{ label: '3j', offsetMs: 259200000 }] },
    { id: 1764094551336, guildId: OTHER_GUILD, channelId: '900000000000000009', titre: 'Devoir B', date: '2099-10-01', description: '', type: 'devoir', importance: 'faible', customTimings: [] },
  ]);

  write('devoirs-archives.json', [
    { id: 1764094551000, guildId: GUILD, channelId: null, titre: 'Vieux', date: '2025-11-26', description: '', type: 'devoir', customTimings: [] },
    ...(withOrphans
      ? [{ id: 1764094551001, guildId: null, channelId: null, titre: 'Sans guild', date: '2025-11-27', description: '', type: 'devoir', customTimings: [] }]
      : []),
  ]);

  write('devoirs-config.json', {
    [GUILD]: {
      roleId: null, reminderChannelId: '910000000000000009',
      boardChannelId: '920000000000000009', boardMessageId: '930000000000000009',
      boardLastUpdate: '2026-01-01', customTimings: [{ label: 'test', offsetMs: 120000000 }],
    },
  });

  write('reminders.json', {
    version: 1,
    reminders: [
      { id: 'r_1', status: 'pending', createdAt: '2026-01-04T13:59:28.012Z', sentAt: null, guildId: GUILD, sourceChannelId: '900000000000000009', devoirId: 1764094551334, kind: '7d', title: 'TP RSA', type: 'examen', importance: 'tres_important', date: '2099-09-12', description: 'a', remindAtISO: '2099-09-05T07:00:00.000Z' },
      { id: 'r_2', status: 'sent', createdAt: '2026-01-04T13:59:28.012Z', sentAt: '2026-04-05T20:16:38.057Z', guildId: GUILD, sourceChannelId: '900000000000000009', devoirId: 1764094551334, kind: '1d-morning', title: 'TP RSA', type: 'examen', importance: 'tres_important', date: '2099-09-12', description: 'a', remindAtISO: '2099-09-11T07:00:00.000Z' },
      { id: 'r_3', status: 'pending', createdAt: '2026-01-04T13:59:28.012Z', sentAt: null, guildId: OTHER_GUILD, sourceChannelId: '900000000000000009', devoirId: 1764094551336, kind: '7d', title: 'Devoir B', type: 'devoir', importance: 'faible', date: '2099-10-01', description: '', remindAtISO: '2099-09-24T07:00:00.000Z' },
    ],
  });

  write('guild-config.json', {
    guilds: {
      [GUILD]: { features: { feur: false, homework: true, stats: true, rss: true, recurringEvents: true }, feur: { cooldownMinutes: 45, rules: [{ id: 'r1', trigger: 'quoi', response: 'Feur.' }] } },
    },
  });

  write('stats.json', { '300000000000000003': 142, '400000000000000004': 7 });
  write('rss-config.json', { [GUILD]: { [`${GUILD}_940000000000000009_1700000000000`]: { url: 'https://exemple.test/rss', channelId: '940000000000000009', customName: 'Flux test' } } });
  write('rss-state.json', { feeds: { [`${GUILD}_940000000000000009_1700000000000`]: { initialized: true, seenIds: ['a', 'b'] } } });
  write('events-config.json', {
    events: { [GUILD]: { [`${GUILD}_1_abc`]: { id: `${GUILD}_1_abc`, guildId: GUILD, title: 'Réunion' } } },
    reminders: {},
    settings: { defaultReminderTimes: [], maxEventsPerGuild: 50, maxParticipantsPerEvent: 100 },
  });

  return { root, dataDir };
}

function runMigration(dataDir, args = []) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, BOT_DATA_DIR: dataDir },
    encoding: 'utf-8',
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(...parts), 'utf-8'));
const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).sort().join('|');

// ---------------------------------------------------------------------------

test('--dry-run ne modifie strictement rien', () => {
  const { dataDir } = makeLegacyData();
  const avant = snapshot(dataDir);

  const { code, out } = runMigration(dataDir, ['--guild-id', GUILD, '--dry-run']);

  assert.equal(code, 0, out);
  assert.match(out, /DRY RUN terminé/);
  assert.match(out, /Aucune donnée modifiée/);
  assert.equal(snapshot(dataDir), avant, 'aucun fichier créé ou supprimé');
  assert.equal(fs.existsSync(path.join(dataDir, 'guilds')), false);
  assert.equal(fs.existsSync(path.join(dataDir, 'schema.json')), false);
});

test('--dry-run annonce les bons compteurs et les catégories détectées', () => {
  const { dataDir } = makeLegacyData();
  const { out } = runMigration(dataDir, ['--guild-id', GUILD, '--dry-run']);

  assert.match(out, /2 devoir\(s\)/, 'serveur principal : 2 devoirs');
  assert.match(out, /1 devoir\(s\)/, 'second serveur : 1 devoir');
  assert.match(out, /2 archive\(s\)/, 'dont l’archive sans guildId');
  assert.match(out, /2 utilisateur\(s\) dans les statistiques/);
  assert.match(out, /1 flux RSS/);
  assert.match(out, /1 événement\(s\) récurrent\(s\)/);
  assert.match(out, /📚 Devoir/);
  assert.match(out, /📝 Examen/);
  assert.match(out, /🚧 Projet/);
});

test('sans --guild-id alors que des données sont orphelines : erreur claire', () => {
  const { dataDir } = makeLegacyData({ withOrphans: true });
  const { code, out } = runMigration(dataDir, ['--dry-run']);

  assert.equal(code, 1);
  assert.match(out, /ACTION REQUISE/);
  assert.match(out, /Je ne devine pas/);
  assert.match(out, /--guild-id/);
  assert.match(out, new RegExp(GUILD), 'les serveurs détectés sont proposés');
  assert.equal(fs.existsSync(path.join(dataDir, 'guilds')), false, 'rien écrit');
});

test('migration réelle : sauvegarde, éclatement par serveur, compteurs conservés', () => {
  const { root, dataDir } = makeLegacyData();
  const { code, out } = runMigration(dataDir, ['--guild-id', GUILD]);

  assert.equal(code, 0, out);
  assert.match(out, /Migration terminée avec succès/);
  assert.match(out, /Validation OK/);

  // --- Sauvegarde ---
  // Elle vit DANS data/ : en conteneur, seul ce dossier est monté, une
  // sauvegarde placée à côté partirait avec le conteneur.
  const backupRoot = path.join(dataDir, 'backups');
  assert.ok(fs.existsSync(backupRoot), 'sauvegarde créée');
  const backups = fs.readdirSync(backupRoot);
  assert.equal(backups.length, 1);
  assert.ok(fs.existsSync(path.join(backupRoot, backups[0], 'data', 'devoirs.json')));

  // La sauvegarde ne se contient pas elle-même.
  assert.equal(
    fs.existsSync(path.join(backupRoot, backups[0], 'data', 'backups')),
    false,
    'la sauvegarde ne doit pas se copier dans elle-même',
  );

  // --- Anciennes données conservées ---
  for (const file of ['devoirs.json', 'devoirs-archives.json', 'reminders.json', 'stats.json']) {
    assert.ok(fs.existsSync(path.join(dataDir, file)), `${file} doit être conservé`);
  }

  // --- Serveur principal ---
  const dirA = path.join(dataDir, 'guilds', GUILD);
  const devoirsA = readJson(dirA, 'devoirs.json');
  const archivesA = readJson(dirA, 'devoirs-archives.json');
  const remindersA = readJson(dirA, 'reminders.json').reminders;
  const categoriesA = readJson(dirA, 'categories.json').categories;

  assert.equal(devoirsA.length, 2);
  assert.equal(archivesA.length, 2, 'l’archive orpheline est rattachée via --guild-id');
  assert.equal(remindersA.length, 2);
  assert.equal(categoriesA.length, 3);
  assert.deepEqual(readJson(dirA, 'stats.json'), { '300000000000000003': 142, '400000000000000004': 7 });
  assert.equal(Object.keys(readJson(dirA, 'rss-config.json').feeds).length, 1);
  assert.equal(Object.keys(readJson(dirA, 'rss-state.json').feeds).length, 1);
  assert.equal(Object.keys(readJson(dirA, 'events.json').events).length, 1);

  // --- Second serveur, correctement séparé ---
  const dirB = path.join(dataDir, 'guilds', OTHER_GUILD);
  assert.equal(readJson(dirB, 'devoirs.json').length, 1);
  assert.equal(readJson(dirB, 'reminders.json').reminders.length, 1);
  assert.deepEqual(readJson(dirB, 'stats.json'), {}, 'les stats globales ne vont pas dans B');
  assert.equal(readJson(dirB, 'devoirs.json')[0].titre, 'Devoir B');

  // --- Schéma ---
  assert.equal(readJson(dataDir, 'schema.json').version, 2);
});

test('migration des catégories : même ancien type → même nouvel ID', () => {
  const { dataDir } = makeLegacyData();
  runMigration(dataDir, ['--guild-id', GUILD]);

  const dirA = path.join(dataDir, 'guilds', GUILD);
  const categories = readJson(dirA, 'categories.json').categories;
  const devoirs = readJson(dirA, 'devoirs.json');
  const archives = readJson(dirA, 'devoirs-archives.json');

  const bySlug = Object.fromEntries(categories.map(c => [c.legacySlug, c]));

  assert.ok(categories.every(c => /^cat_[0-9a-f]{6}$/.test(c.id)), 'ID stables');
  assert.equal(devoirs.find(d => d.titre === 'TP RSA').categoryId, bySlug.examen.id);
  assert.equal(devoirs.find(d => d.titre === 'Projet IPS').categoryId, bySlug.projet.id);

  // Les deux archives de type "devoir" pointent vers la MÊME catégorie.
  const idsDevoir = archives.map(a => a.categoryId);
  assert.equal(new Set(idsDevoir).size, 1);
  assert.equal(idsDevoir[0], bySlug.devoir.id);

  // Le miroir legacy `type` reste synchronisé (retour arrière possible).
  assert.equal(devoirs.find(d => d.titre === 'TP RSA').type, 'examen');
});

test('migration : les identifiants et les relations rappel/devoir sont préservés', () => {
  const { dataDir } = makeLegacyData();
  runMigration(dataDir, ['--guild-id', GUILD]);

  const dirA = path.join(dataDir, 'guilds', GUILD);
  const devoirs = readJson(dirA, 'devoirs.json');
  const reminders = readJson(dirA, 'reminders.json').reminders;

  // IDs numériques d'origine conservés tels quels : aucun remapping risqué.
  assert.deepEqual(devoirs.map(d => d.id).sort(), [1764094551334, 1764094551335]);

  const ids = new Set(devoirs.map(d => String(d.id)));
  for (const reminder of reminders) {
    assert.ok(ids.has(String(reminder.devoirId)), 'chaque rappel pointe un devoir existant');
    assert.equal(reminder.guildId, GUILD);
    assert.ok(reminder.categoryId, 'catégorie propagée sur le rappel');
  }

  // Les nouveaux champs sont présents avec des valeurs neutres.
  assert.ok(devoirs.every(d => d.matiere === ''), 'matiere ajoutée (à compléter)');
  assert.ok(devoirs.every(d => d.heure === null), 'heure ajoutée');
  assert.ok(devoirs.every(d => d.createdAt), 'createdAt déduit de l’ancien ID horodaté');
});

test('la configuration du serveur est reprise, le message du tableau réinitialisé', () => {
  const { dataDir } = makeLegacyData();
  runMigration(dataDir, ['--guild-id', GUILD]);

  const config = readJson(path.join(dataDir, 'guilds', GUILD), 'config.json');

  assert.equal(config.version, 2);
  assert.equal(config.features.feur, false, 'feature désactivée conservée');
  assert.equal(config.feur.cooldownMinutes, 45);
  assert.equal(config.devoirs.reminderChannelId, '910000000000000009');
  assert.equal(config.devoirs.boardChannelId, '920000000000000009');
  assert.equal(config.devoirs.customTimings.length, 1);
  assert.equal(config.devoirs.boardMessageId, null, 'le tableau sera republié au nouveau format');
});

test('une seconde migration est détectée et refusée proprement', () => {
  const { dataDir } = makeLegacyData();
  runMigration(dataDir, ['--guild-id', GUILD]);

  const avant = snapshot(dataDir);
  const { code, out } = runMigration(dataDir, ['--guild-id', GUILD]);

  assert.equal(code, 0);
  assert.match(out, /déjà au schéma v2/);
  assert.match(out, /Aucune migration nécessaire/);
  assert.equal(snapshot(dataDir), avant, 'rien n’a bougé');
});

test('la destination existante n’est jamais écrasée sans --force', () => {
  const { root, dataDir } = makeLegacyData();
  runMigration(dataDir, ['--guild-id', GUILD]);

  // On simule un schema.json resté en v1 alors que data/guilds/ est peuplé.
  fs.writeFileSync(path.join(dataDir, 'schema.json'), JSON.stringify({ version: 1 }));

  const { code, out } = runMigration(dataDir, ['--guild-id', GUILD]);

  assert.equal(code, 1);
  assert.match(out, /contient déjà des données/);
  assert.match(out, /--force/);
  assert.equal(fs.readdirSync(path.join(dataDir, 'backups')).length, 1, 'aucune seconde sauvegarde');
});

test('installation vierge : le schéma est simplement initialisé', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-mig-vide-'));
  tempDirs.push(root);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // Selon qu'il reste ou non des fichiers legacy à la racine du dépôt, le
  // script annonce "installation vierge" ou "aucun serveur à migrer" : dans
  // les deux cas il ne doit rien écrire en dry-run, et poser le schéma v2 sinon.
  const dry = runMigration(dataDir, ['--dry-run']);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /installation vierge|Aucun serveur à migrer/);
  assert.match(dry.out, /Aucune donnée modifiée/);
  assert.equal(fs.existsSync(path.join(dataDir, 'schema.json')), false, 'dry-run n’écrit rien');
  assert.equal(fs.existsSync(path.join(dataDir, 'guilds')), false);

  const real = runMigration(dataDir, []);
  assert.equal(real.code, 0, real.out);
  assert.equal(readJson(dataDir, 'schema.json').version, 2);
});

test('un --guild-id malformé est rejeté avant toute lecture', () => {
  const { dataDir } = makeLegacyData();

  for (const bad of ['abc', '123', '../../etc', '1234567890123456789012345']) {
    const { code, out } = runMigration(dataDir, ['--guild-id', bad]);
    assert.equal(code, 2, `${bad} devait être rejeté`);
    assert.match(out, /--guild-id invalide/);
  }

  assert.equal(fs.existsSync(path.join(dataDir, 'guilds')), false);
});
