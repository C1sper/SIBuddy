// tests/devoirs.test.js — cycle de vie des devoirs et des rappels associés
const { useIsolatedDataDir, GUILD_A, GUILD_B } = require('./helpers/isolatedData');
useIsolatedDataDir();

const test = require('node:test');
const assert = require('node:assert/strict');

const devoirsService = require('../services/devoirsService');
const categoriesService = require('../services/categoriesService');
const remindersStore = require('../services/remindersStore');

const CHANNEL_A = '500000000000000005';
const CHANNEL_B = '600000000000000006';

/** Date au format AAAA-MM-JJ, décalée de N jours par rapport à aujourd'hui. */
function inDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pending(guildId, devoirId) {
  return remindersStore
    .listByGuild(guildId)
    .filter(r => String(r.devoirId) === String(devoirId) && r.status === 'pending');
}

test('créer un devoir : champs, catégorie et rappels', () => {
  const categorie = categoriesService.resolveCategory(GUILD_A, 'Examen');

  const result = devoirsService.addDevoir({
    guildId: GUILD_A,
    channelId: CHANNEL_A,
    matiere: 'Cryptographie',
    titre: 'TP RSA',
    date: inDays(30),
    heure: '14:30',
    description: 'Chiffrement asymétrique',
    categoryRef: categorie.id,
    importance: 'tres_important',
  });

  assert.equal(result.ok, true, result.error);
  assert.match(String(result.devoir.id), /^hw_/, 'ID stable généré');
  assert.equal(result.devoir.matiere, 'Cryptographie');
  assert.equal(result.devoir.titre, 'TP RSA');
  assert.equal(result.devoir.heure, '14:30');
  assert.equal(result.devoir.categoryId, categorie.id);
  assert.equal(result.devoir.type, 'examen', 'miroir legacy tenu à jour');
  assert.ok(result.remindersCreated.length >= 2, 'J-7 et J-1 programmés');
});

test('validation : titre, date, heure et catégorie', () => {
  const base = { guildId: GUILD_A, channelId: CHANNEL_A, titre: 'X', date: inDays(10) };
  const categorie = categoriesService.getFallbackCategory(GUILD_A);

  assert.match(devoirsService.addDevoir({ ...base, titre: '' }).error, /titre est requis/);
  assert.match(devoirsService.addDevoir({ ...base, date: '15/01/2099' }).error, /AAAA-MM-JJ/);
  assert.match(devoirsService.addDevoir({ ...base, date: '2099-02-31' }).error, /AAAA-MM-JJ/);
  assert.match(devoirsService.addDevoir({ ...base, heure: '25:00', categoryRef: categorie.id }).error, /Heure invalide/);
  assert.match(devoirsService.addDevoir({ ...base, heure: '14h30', categoryRef: categorie.id }).error, /HH:mm/);
  assert.match(devoirsService.addDevoir({ ...base, categoryRef: 'cat_inexistant' }).error, /n’existe pas/);
  assert.match(devoirsService.addDevoir({ ...base, guildId: 'invalide' }).error, /dans un serveur/);
});

test('modifier un devoir : ID conservé, rappels reconstruits, aucun doublon', () => {
  const created = devoirsService.addDevoir({
    guildId: GUILD_A, channelId: CHANNEL_A, matiere: 'Réseau', titre: 'Projet IPS',
    date: inDays(40), categoryRef: categoriesService.resolveCategory(GUILD_A, 'Projet').id,
  });
  const id = created.devoir.id;

  const avant = pending(GUILD_A, id).map(r => r.id);
  assert.ok(avant.length >= 2);

  const updated = devoirsService.updateDevoir(GUILD_A, id, {
    matiere: 'Réseaux avancés',
    titre: 'Projet IPS/IDS',
    date: inDays(60),
  });

  assert.equal(updated.ok, true, updated.error);
  assert.equal(updated.devoir.id, id, 'ID stable préservé');
  assert.equal(updated.devoir.matiere, 'Réseaux avancés');
  assert.equal(updated.devoir.date, inDays(60));
  assert.ok(updated.devoir.updatedAt, 'updatedAt renseigné');

  // Les anciens rappels sont annulés, les nouveaux créés : aucun doublon.
  const tous = remindersStore.listByGuild(GUILD_A).filter(r => String(r.devoirId) === String(id));
  const annules = tous.filter(r => avant.includes(r.id));
  assert.ok(annules.every(r => r.status === 'cancelled'), 'anciens rappels annulés');

  const apres = pending(GUILD_A, id);
  assert.ok(apres.length >= 2, 'nouveaux rappels créés');
  assert.equal(apres.filter(r => avant.includes(r.id)).length, 0, 'aucun ancien rappel encore actif');

  const dates = new Set(apres.map(r => r.date));
  assert.deepEqual([...dates], [inDays(60)], 'les rappels pointent la nouvelle échéance');

  // Un seul exemplaire du devoir en base.
  assert.equal(devoirsService.readDevoirs(GUILD_A).filter(d => d.id === id).length, 1);
});

test('changer la catégorie d’un devoir met à jour categoryId ET le miroir type', () => {
  const created = devoirsService.addDevoir({
    guildId: GUILD_A, channelId: CHANNEL_A, titre: 'Oral blanc', date: inDays(20),
    categoryRef: categoriesService.resolveCategory(GUILD_A, 'Devoir').id,
  });

  const examen = categoriesService.resolveCategory(GUILD_A, 'Examen');
  const updated = devoirsService.updateDevoir(GUILD_A, created.devoir.id, { categoryRef: examen.id });

  assert.equal(updated.ok, true, updated.error);
  assert.equal(updated.devoir.categoryId, examen.id);
  assert.equal(updated.devoir.type, 'examen');
});

test('supprimer un devoir annule ses rappels en attente', () => {
  const created = devoirsService.addDevoir({
    guildId: GUILD_A, channelId: CHANNEL_A, titre: 'À supprimer', date: inDays(25),
    categoryRef: categoriesService.getFallbackCategory(GUILD_A).id,
  });
  const id = created.devoir.id;

  const result = devoirsService.deleteDevoir(GUILD_A, id);

  assert.equal(result.ok, true, result.error);
  assert.ok(result.cancelledCount >= 2);
  assert.equal(devoirsService.readDevoirs(GUILD_A).some(d => d.id === id), false);
  assert.equal(pending(GUILD_A, id).length, 0);

  assert.equal(devoirsService.deleteDevoir(GUILD_A, id).ok, false, 'seconde suppression refusée');
});

test('archiver un devoir le sort des devoirs actifs sans le perdre', () => {
  const created = devoirsService.addDevoir({
    guildId: GUILD_A, channelId: CHANNEL_A, titre: 'À archiver', date: inDays(5),
    categoryRef: categoriesService.getFallbackCategory(GUILD_A).id,
  });

  const result = devoirsService.archiveDevoir(GUILD_A, created.devoir.id);

  assert.equal(result.ok, true, result.error);
  assert.equal(devoirsService.readDevoirs(GUILD_A).some(d => d.id === created.devoir.id), false);
  assert.equal(devoirsService.readArchive(GUILD_A).some(d => d.id === created.devoir.id), true);
  assert.equal(pending(GUILD_A, created.devoir.id).length, 0, 'rappels annulés');
});

test('les devoirs passés sont archivés automatiquement', () => {
  // Écriture directe d'une échéance dépassée (addDevoir ne l'accepterait pas côté rappels).
  const devoirs = devoirsService.readDevoirs(GUILD_A);
  devoirs.push({
    id: 'hw_perime', guildId: GUILD_A, channelId: CHANNEL_A,
    matiere: 'Histoire', titre: 'Ancien devoir', date: inDays(-3), heure: null,
    description: '', categoryId: categoriesService.getFallbackCategory(GUILD_A).id,
    type: 'devoir', importance: 'important', customTimings: [],
  });
  devoirsService.writeDevoirs(GUILD_A, devoirs);

  const moved = devoirsService.movePastDevoirsToArchive(GUILD_A);

  assert.equal(moved, 1);
  assert.equal(devoirsService.readDevoirs(GUILD_A).some(d => d.id === 'hw_perime'), false);
  assert.equal(devoirsService.readArchive(GUILD_A).some(d => d.id === 'hw_perime'), true);
  assert.equal(devoirsService.movePastDevoirsToArchive(GUILD_A), 0, 'pas de double archivage');
});

test('les timings personnalisés régénèrent les rappels', () => {
  const created = devoirsService.addDevoir({
    guildId: GUILD_A, channelId: CHANNEL_A, titre: 'Avec timings', date: inDays(50),
    categoryRef: categoriesService.getFallbackCategory(GUILD_A).id,
  });
  const id = created.devoir.id;
  const avant = pending(GUILD_A, id).length;

  const added = devoirsService.addCustomTiming(GUILD_A, id, '3 jours avant', '3j');
  assert.equal(added.ok, true, added.error);
  assert.equal(pending(GUILD_A, id).length, avant + 1);

  assert.equal(devoirsService.addCustomTiming(GUILD_A, id, 'x', 'n’importe quoi').ok, false);

  const removed = devoirsService.removeCustomTiming(GUILD_A, id, 0);
  assert.equal(removed.ok, true, removed.error);
  assert.equal(pending(GUILD_A, id).length, avant);
});

test('getUpcoming trie chronologiquement et exclut le passé', () => {
  const guild = '700000000000000007';
  const categorie = categoriesService.getFallbackCategory(guild);

  for (const days of [30, 5, 20]) {
    devoirsService.addDevoir({
      guildId: guild, channelId: CHANNEL_A, titre: `J+${days}`, date: inDays(days),
      categoryRef: categorie.id,
    });
  }

  const upcoming = devoirsService.getUpcoming(guild);
  assert.deepEqual(upcoming.map(d => d.titre), ['J+5', 'J+20', 'J+30']);
});

// ---------------------------------------------------------------------------
// Cloisonnement multi-serveur
// ---------------------------------------------------------------------------

test('le serveur A ne voit jamais les devoirs du serveur B', () => {
  const cryptoA = devoirsService.addDevoir({
    guildId: GUILD_A, channelId: CHANNEL_A, matiere: 'Cryptographie', titre: 'TP',
    date: inDays(15), categoryRef: categoriesService.getFallbackCategory(GUILD_A).id,
  });
  const mathsB = devoirsService.addDevoir({
    guildId: GUILD_B, channelId: CHANNEL_B, matiere: 'Mathématiques', titre: 'Examen',
    date: inDays(15), categoryRef: categoriesService.getFallbackCategory(GUILD_B).id,
  });

  assert.equal(cryptoA.ok, true, cryptoA.error);
  assert.equal(mathsB.ok, true, mathsB.error);

  const titresA = devoirsService.getUpcoming(GUILD_A).map(d => d.titre);
  const titresB = devoirsService.getUpcoming(GUILD_B).map(d => d.titre);

  assert.ok(titresA.includes('TP'));
  assert.ok(!titresA.includes('Examen'), 'aucune fuite de B vers A');
  assert.deepEqual(titresB, ['Examen']);
});

test('le serveur A ne peut ni modifier ni supprimer un devoir du serveur B', () => {
  const cible = devoirsService.getUpcoming(GUILD_B)[0];
  assert.ok(cible, 'le serveur B a bien un devoir');

  const suppression = devoirsService.deleteDevoir(GUILD_A, cible.id);
  assert.equal(suppression.ok, false);
  assert.match(suppression.error, /n’existe plus/);

  const modification = devoirsService.updateDevoir(GUILD_A, cible.id, { titre: 'Piraté' });
  assert.equal(modification.ok, false);

  const archivage = devoirsService.archiveDevoir(GUILD_A, cible.id);
  assert.equal(archivage.ok, false);

  // Le devoir de B est intact.
  const apres = devoirsService.readDevoirs(GUILD_B).find(d => d.id === cible.id);
  assert.equal(apres.titre, 'Examen');
});

test('les rappels d’un serveur ne sont jamais annulés depuis un autre', () => {
  const cible = devoirsService.getUpcoming(GUILD_B)[0];
  const avant = pending(GUILD_B, cible.id).length;
  assert.ok(avant > 0);

  assert.equal(remindersStore.cancelByDevoirId(GUILD_A, cible.id), 0);
  assert.equal(pending(GUILD_B, cible.id).length, avant, 'rappels de B intacts');
});

// ---------------------------------------------------------------------------
// Heure d'échéance (défaut : minuit)
// ---------------------------------------------------------------------------

test('l’heure vaut minuit par défaut, sans être écrite en base', () => {
  const created = devoirsService.addDevoir({
    guildId: GUILD_A, channelId: CHANNEL_A, matiere: 'Histoire', titre: 'Sans heure',
    date: inDays(12), categoryRef: categoriesService.getFallbackCategory(GUILD_A).id,
  });
  assert.equal(created.ok, true, created.error);

  // Rien n'est écrit : les devoirs hérités (heure absente) restent intacts.
  assert.equal(created.devoir.heure, null, 'heure non stockée');

  // Mais l'heure effective est bien minuit.
  assert.equal(devoirsService.getEffectiveHeure(created.devoir), '00:00');
  assert.equal(devoirsService.getDeadline(created.devoir).getHours(), 0);
  assert.equal(devoirsService.getDeadline(created.devoir).getMinutes(), 0);
  assert.equal(devoirsService.formatEcheance(created.devoir), `${inDays(12)} à 00:00`);
});

test('une heure explicite est conservée et utilisée', () => {
  const created = devoirsService.addDevoir({
    guildId: GUILD_A, channelId: CHANNEL_A, titre: 'Avec heure', date: inDays(13), heure: '17:45',
    categoryRef: categoriesService.getFallbackCategory(GUILD_A).id,
  });
  assert.equal(created.ok, true, created.error);

  assert.equal(created.devoir.heure, '17:45');
  assert.equal(devoirsService.getEffectiveHeure(created.devoir), '17:45');
  assert.equal(devoirsService.getDeadline(created.devoir).getHours(), 17);
  assert.equal(devoirsService.formatEcheance(created.devoir), `${inDays(13)} à 17:45`);
});

test('un devoir hérité (heure absente) est traité comme minuit sans réécriture', () => {
  const devoirs = devoirsService.readDevoirs(GUILD_A);
  devoirs.push({
    id: 'hw_legacy_heure', guildId: GUILD_A, channelId: CHANNEL_A,
    titre: 'Devoir v1', date: inDays(14),
    categoryId: categoriesService.getFallbackCategory(GUILD_A).id,
    type: 'devoir', importance: 'important', customTimings: [],
    // pas de champ `heure` du tout, comme dans les données du schéma v1
  });
  devoirsService.writeDevoirs(GUILD_A, devoirs);

  const relu = devoirsService.readDevoirs(GUILD_A).find(d => d.id === 'hw_legacy_heure');
  assert.equal(relu.heure, null, 'toujours pas d’heure en base');
  assert.equal(devoirsService.getEffectiveHeure(relu), '00:00');
  assert.equal(devoirsService.getDeadline(relu).getHours(), 0);
});

test('vider l’heure d’un devoir le ramène à minuit', () => {
  const created = devoirsService.addDevoir({
    guildId: GUILD_A, channelId: CHANNEL_A, titre: 'Heure retirée', date: inDays(15), heure: '09:15',
    categoryRef: categoriesService.getFallbackCategory(GUILD_A).id,
  });

  const updated = devoirsService.updateDevoir(GUILD_A, created.devoir.id, { heure: '' });

  assert.equal(updated.ok, true, updated.error);
  assert.equal(updated.devoir.heure, null);
  assert.equal(devoirsService.getEffectiveHeure(updated.devoir), '00:00');
});

test('une heure invalide est refusée', () => {
  const base = {
    guildId: GUILD_A, channelId: CHANNEL_A, titre: 'X', date: inDays(16),
    categoryRef: categoriesService.getFallbackCategory(GUILD_A).id,
  };

  for (const heure of ['25:00', '12:75', '9:30', '14h30', 'midi']) {
    const result = devoirsService.addDevoir({ ...base, heure });
    assert.equal(result.ok, false, `"${heure}" aurait dû être refusée`);
  }
});

test('parseDateTimeInput découpe la saisie des modals', () => {
  assert.deepEqual(devoirsService.parseDateTimeInput('2026-09-12'), { date: '2026-09-12', heure: null });
  assert.deepEqual(devoirsService.parseDateTimeInput('2026-09-12 14:30'), { date: '2026-09-12', heure: '14:30' });
  assert.deepEqual(devoirsService.parseDateTimeInput('  2026-09-12   08:05 '), { date: '2026-09-12', heure: '08:05' });
});

test('l’heure décale bien les rappels personnalisés', () => {
  const categorie = categoriesService.getFallbackCategory(GUILD_A).id;

  const minuit = devoirsService.addDevoir({
    guildId: GUILD_A, channelId: CHANNEL_A, titre: 'Minuit', date: inDays(20),
    categoryRef: categorie, timingsStr: '2j',
  });
  const soir = devoirsService.addDevoir({
    guildId: GUILD_A, channelId: CHANNEL_A, titre: 'Soir', date: inDays(20), heure: '18:00',
    categoryRef: categorie, timingsStr: '2j',
  });

  const custom = (r) => r.remindersCreated.find(x => x.kind.startsWith('custom-'));
  const ecart = new Date(custom(soir).remindAtISO) - new Date(custom(minuit).remindAtISO);

  assert.equal(ecart, 18 * 60 * 60 * 1000, 'le rappel "2j" suit l’heure de l’échéance');
});

test('un devoir du jour reste listé même quand son heure est passée', () => {
  const guild = '800000000000000008';
  const categorie = categoriesService.getFallbackCategory(guild).id;

  for (const [titre, heure] of [['Minuit', null], ['Ce matin', '08:00'], ['Ce soir', '23:59']]) {
    const r = devoirsService.addDevoir({
      guildId: guild, channelId: CHANNEL_A, matiere: 'Test', titre,
      date: inDays(0), heure, categoryRef: categorie,
    });
    assert.equal(r.ok, true, r.error);
  }

  const upcoming = devoirsService.getUpcoming(guild);
  assert.deepEqual(upcoming.map(d => d.titre), ['Minuit', 'Ce matin', 'Ce soir']);

  // Certaines échéances sont déjà dépassées : elles restent quand même listées.
  const passees = upcoming.filter(d => devoirsService.getDeadline(d) < new Date());
  assert.ok(passees.length >= 1, 'au moins une échéance du jour est déjà passée');

  // Et l'archivage ne les emporte pas : il se déclenche le lendemain.
  assert.equal(devoirsService.movePastDevoirsToArchive(guild), 0);
  assert.equal(devoirsService.getUpcoming(guild).length, 3);
});
