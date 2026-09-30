// tests/categories.test.js — catégories dynamiques par serveur
const { useIsolatedDataDir, GUILD_A, GUILD_B } = require('./helpers/isolatedData');
useIsolatedDataDir();

const test = require('node:test');
const assert = require('node:assert/strict');

const categories = require('../services/categoriesService');
const devoirsService = require('../services/devoirsService');

const CHANNEL = '500000000000000005';

function addDevoir(guildId, categoryRef, titre = 'Test') {
  const result = devoirsService.addDevoir({
    guildId,
    channelId: CHANNEL,
    matiere: 'Cryptographie',
    titre,
    date: '2099-01-15',
    categoryRef,
  });
  assert.equal(result.ok, true, result.error);
  return result.devoir;
}

test('un nouveau serveur reçoit les catégories par défaut du projet', () => {
  const list = categories.listCategories(GUILD_A);

  assert.deepEqual(list.map(c => c.name), ['Devoir', 'Examen', 'Projet']);
  assert.deepEqual(list.map(c => c.emoji), ['📚', '📝', '🚧']);
  assert.ok(list.every(c => c.enabled));
  assert.ok(list.every(c => /^cat_[0-9a-f]{6}$/.test(c.id)), 'ID stables');
  assert.deepEqual(list.map(c => c.order), [0, 1, 2]);
});

test('chaque serveur possède ses propres catégories', () => {
  const added = categories.addCategory(GUILD_A, { name: 'Oral', emoji: '🎤' });
  assert.equal(added.ok, true, added.error);

  assert.equal(categories.listCategories(GUILD_A).length, 4);
  assert.equal(categories.listCategories(GUILD_B).length, 3, 'B n’a pas hérité de la catégorie de A');
  assert.equal(categories.resolveCategory(GUILD_B, 'Oral'), null);
});

test('ajouter une catégorie : validation du nom et de l’emoji', () => {
  assert.equal(categories.addCategory(GUILD_A, { name: '' }).ok, false, 'nom vide');
  assert.equal(categories.addCategory(GUILD_A, { name: 'x'.repeat(41) }).ok, false, 'nom trop long');
  assert.equal(categories.addCategory(GUILD_A, { name: 'Oral' }).ok, false, 'doublon');
  assert.equal(categories.addCategory(GUILD_A, { name: 'oral' }).ok, false, 'doublon insensible à la casse');
  assert.equal(categories.addCategory(GUILD_A, { name: 'Stage', emoji: 'pas un emoji' }).ok, false);

  // L'emoji est facultatif : la catégorie doit fonctionner sans.
  const sansEmoji = categories.addCategory(GUILD_A, { name: 'Stage' });
  assert.equal(sansEmoji.ok, true, sansEmoji.error);
  assert.equal(sansEmoji.category.emoji, null);
  assert.equal(categories.formatCategory(sansEmoji.category), 'Stage');
});

test('renommer une catégorie garde son ID et n’altère aucun devoir', () => {
  const projet = categories.resolveCategory(GUILD_A, 'Projet');
  const devoir = addDevoir(GUILD_A, projet.id, 'TP réseau');

  const updated = categories.updateCategory(GUILD_A, projet.id, { name: 'Projet de groupe', emoji: '💼' });
  assert.equal(updated.ok, true, updated.error);
  assert.equal(updated.category.id, projet.id, 'ID stable inchangé');
  assert.equal(updated.category.name, 'Projet de groupe');

  const stored = devoirsService.readDevoirs(GUILD_A).find(d => d.id === devoir.id);
  assert.equal(stored.categoryId, projet.id, 'le devoir référence toujours le même ID');
  assert.equal(
    devoirsService.getDevoirCategory(GUILD_A, stored).name,
    'Projet de groupe',
    'le devoir affiche automatiquement le nouveau nom',
  );
});

test('désactiver puis réactiver une catégorie', () => {
  const stage = categories.resolveCategory(GUILD_A, 'Stage');

  const off = categories.setCategoryEnabled(GUILD_A, stage.id, false);
  assert.equal(off.ok, true, off.error);
  assert.equal(categories.getCategory(GUILD_A, stage.id).enabled, false);

  // Désactivée : plus proposée à la création, mais toujours dans les données.
  const names = categories.listCategories(GUILD_A, { enabledOnly: true }).map(c => c.name);
  assert.ok(!names.includes('Stage'));
  assert.ok(categories.listCategories(GUILD_A).some(c => c.name === 'Stage'));

  // ...et refusée à la création d'un nouveau devoir.
  const refus = devoirsService.addDevoir({
    guildId: GUILD_A, channelId: CHANNEL, titre: 'X', date: '2099-01-15', categoryRef: stage.id,
  });
  assert.equal(refus.ok, false);
  assert.match(refus.error, /désactivée/);

  const on = categories.toggleCategory(GUILD_A, stage.id);
  assert.equal(on.ok, true, on.error);
  assert.equal(categories.getCategory(GUILD_A, stage.id).enabled, true);
});

test('impossible de désactiver la dernière catégorie active', () => {
  const all = categories.listCategories(GUILD_B);
  for (const cat of all.slice(0, all.length - 1)) {
    assert.equal(categories.setCategoryEnabled(GUILD_B, cat.id, false).ok, true);
  }

  const last = categories.listCategories(GUILD_B, { enabledOnly: true })[0];
  const result = categories.setCategoryEnabled(GUILD_B, last.id, false);
  assert.equal(result.ok, false);
  assert.match(result.error, /au moins une catégorie active/);

  for (const cat of all) categories.setCategoryEnabled(GUILD_B, cat.id, true);
});

test('une catégorie inutilisée peut être supprimée', () => {
  const created = categories.addCategory(GUILD_A, { name: 'Éphémère', emoji: '💨' });
  const result = categories.deleteCategory(GUILD_A, created.category.id);

  assert.equal(result.ok, true, result.error);
  assert.equal(categories.getCategory(GUILD_A, created.category.id), null);
});

test('une catégorie utilisée ne peut PAS être supprimée', () => {
  const examen = categories.resolveCategory(GUILD_A, 'Examen');
  addDevoir(GUILD_A, examen.id, 'CC n°2');

  const result = categories.deleteCategory(GUILD_A, examen.id);

  assert.equal(result.ok, false);
  assert.equal(result.inUse, true);
  assert.equal(result.usage.active, 1);
  assert.match(result.error, /utilisée par 1 devoir/);
  assert.ok(categories.getCategory(GUILD_A, examen.id), 'la catégorie est toujours là');
});

test('réattribuer les devoirs permet ensuite la suppression, sans perdre de devoir', () => {
  const examen = categories.resolveCategory(GUILD_A, 'Examen');
  const devoir = categories.resolveCategory(GUILD_A, 'Devoir');

  const avant = devoirsService.readDevoirs(GUILD_A).length;

  const reassigned = categories.reassignCategory(GUILD_A, examen.id, devoir.id);
  assert.equal(reassigned.ok, true, reassigned.error);
  assert.equal(reassigned.moved, 1);

  const deleted = categories.deleteCategory(GUILD_A, examen.id);
  assert.equal(deleted.ok, true, deleted.error);

  const apres = devoirsService.readDevoirs(GUILD_A);
  assert.equal(apres.length, avant, 'aucun devoir supprimé');
  assert.ok(apres.every(d => d.categoryId !== examen.id), 'aucune référence orpheline');
  assert.ok(apres.every(d => categories.getCategory(GUILD_A, d.categoryId)), 'toutes les références résolvent');
});

test('l’ordre des catégories est modifiable et persistant', () => {
  const before = categories.listCategories(GUILD_A).map(c => c.name);
  const second = categories.listCategories(GUILD_A)[1];

  const moved = categories.moveCategory(GUILD_A, second.id, 'up');
  assert.equal(moved.ok, true, moved.error);

  const after = categories.listCategories(GUILD_A).map(c => c.name);
  assert.equal(after[0], before[1]);
  assert.equal(after[1], before[0]);
  assert.deepEqual(categories.listCategories(GUILD_A).map(c => c.order), after.map((_, i) => i));

  const premier = categories.listCategories(GUILD_A)[0];
  assert.equal(categories.moveCategory(GUILD_A, premier.id, 'up').ok, false, 'déjà tout en haut');
});

test('autocomplétion : propre au serveur, actives seulement, valeur = ID stable', () => {
  const choicesA = categories.buildAutocompleteChoices(GUILD_A, '');
  const choicesB = categories.buildAutocompleteChoices(GUILD_B, '');

  assert.notDeepEqual(choicesA.map(c => c.name), choicesB.map(c => c.name));
  assert.ok(choicesA.every(c => /^cat_[0-9a-f]{6}$/.test(c.value)), 'valeurs = ID stables');
  assert.ok(choicesA.length <= 25, 'limite Discord respectée');

  // Filtrage insensible à la casse.
  assert.deepEqual(categories.buildAutocompleteChoices(GUILD_A, 'ORAL').map(c => c.name), ['🎤 Oral']);

  // Une catégorie désactivée disparaît des propositions de création.
  const oral = categories.resolveCategory(GUILD_A, 'Oral');
  categories.setCategoryEnabled(GUILD_A, oral.id, false);
  assert.equal(categories.buildAutocompleteChoices(GUILD_A, 'Oral').length, 0);
  assert.equal(
    categories.buildAutocompleteChoices(GUILD_A, 'Oral', { enabledOnly: false }).length,
    1,
    'toujours proposée pour filtrer d’anciens devoirs',
  );
});
