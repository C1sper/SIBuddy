// tests/board.test.js — rendu du tableau des dates importantes
const { useIsolatedDataDir } = require('./helpers/isolatedData');
useIsolatedDataDir();

const test = require('node:test');
const assert = require('node:assert/strict');

const board = require('../services/devoir-board');
const devoirsService = require('../services/devoirsService');

let counter = 0;
function devoir({ matiere = 'Cryptographie', titre = 'TP RSA', date, heure = null }) {
  return {
    id: `hw_test${counter++}`,
    guildId: '100000000000000001',
    matiere, titre, date, heure,
    description: '', categoryId: 'cat_000000', type: 'devoir',
    importance: 'important', customTimings: [],
  };
}

/** Concatène les descriptions de tous les embeds de tous les messages. */
function fullText(messages) {
  return messages.flatMap(m => m.embeds).map(e => e.data.description).join('\n');
}

test('tableau vide : message clair, jamais d’embed cassé', () => {
  const messages = board.buildBoardMessages([]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].embeds.length, 1);

  const description = messages[0].embeds[0].data.description;
  assert.match(description, /^# 📅 DATES IMPORTANTES/);
  assert.match(description, /Aucune date importante à venir pour le moment\./);
  assert.ok(description.length > 0, 'description non vide');
});

test('une seule date : format exact avec timestamps Discord', () => {
  const item = devoir({ matiere: 'Cryptographie', titre: 'TP RSA', date: '2026-09-12' });
  const ts = Math.floor(devoirsService.getDisplayDate(item).getTime() / 1000);

  const text = fullText(board.buildBoardMessages([item]));

  assert.match(text, /^# 📅 DATES IMPORTANTES/);
  assert.match(text, /## SEPTEMBRE 2026/);
  assert.ok(
    text.includes(`- <t:${ts}:d> (soit <t:${ts}:R>) : **Cryptographie** → TP RSA`),
    `ligne attendue absente :\n${text}`,
  );
});

test('sans matière, la ligne reste lisible', () => {
  const text = fullText(board.buildBoardMessages([devoir({ matiere: '', titre: 'Ancien devoir', date: '2026-09-12' })]));
  assert.match(text, /: \*\*Ancien devoir\*\*$/m);
  assert.ok(!text.includes('→'), 'pas de flèche orpheline');
});

test('plusieurs dates dans le même mois : un seul titre de mois, ordre chronologique', () => {
  const items = [
    devoir({ titre: 'A', date: '2026-09-03' }),
    devoir({ titre: 'B', date: '2026-09-12' }),
    devoir({ titre: 'C', date: '2026-09-28' }),
  ];

  const text = fullText(board.buildBoardMessages(items));

  assert.equal((text.match(/## SEPTEMBRE 2026/g) || []).length, 1);
  assert.ok(text.indexOf('→ A') < text.indexOf('→ B'));
  assert.ok(text.indexOf('→ B') < text.indexOf('→ C'));
});

test('plusieurs mois : un titre par mois, en français et dans l’ordre', () => {
  const items = [
    devoir({ titre: 'Sept', date: '2026-09-12' }),
    devoir({ titre: 'Oct', date: '2026-10-02' }),
    devoir({ titre: 'Nov', date: '2026-11-20' }),
  ];

  const text = fullText(board.buildBoardMessages(items));

  assert.match(text, /## SEPTEMBRE 2026/);
  assert.match(text, /## OCTOBRE 2026/);
  assert.match(text, /## NOVEMBRE 2026/);
  assert.ok(text.indexOf('SEPTEMBRE') < text.indexOf('OCTOBRE'));
  assert.ok(text.indexOf('OCTOBRE') < text.indexOf('NOVEMBRE'));
});

test('passage d’une année à l’autre', () => {
  const items = [
    devoir({ titre: 'Fin 2026', date: '2026-12-18' }),
    devoir({ titre: 'Début 2027', date: '2027-01-08' }),
  ];

  const text = fullText(board.buildBoardMessages(items));

  assert.match(text, /## DÉCEMBRE 2026/);
  assert.match(text, /## JANVIER 2027/);
  assert.ok(text.indexOf('DÉCEMBRE 2026') < text.indexOf('JANVIER 2027'));
});

test('les 12 mois sont bien en français', () => {
  assert.deepEqual(board.MONTHS_FR, [
    'JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN',
    'JUILLET', 'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE',
  ]);
});

test('beaucoup de devoirs : limites Discord respectées, AUCUN devoir tronqué', () => {
  const items = [];
  for (let mois = 1; mois <= 12; mois++) {
    for (let jour = 1; jour <= 25; jour++) {
      items.push(devoir({
        matiere: `Matière ${mois}`,
        titre: `Tâche très détaillée numéro ${jour} du mois ${mois}`,
        date: `2027-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`,
      }));
    }
  }
  assert.equal(items.length, 300);

  const messages = board.buildBoardMessages(items);
  const embeds = messages.flatMap(m => m.embeds);

  // Toutes les lignes sont présentes : rien n'est perdu en silence.
  const lignes = fullText(messages).split('\n').filter(l => l.startsWith('- <t:'));
  assert.equal(lignes.length, 300, 'les 300 dates doivent être affichées');

  // Limites Discord.
  for (const embed of embeds) {
    assert.ok(embed.data.description.length <= 4096, 'description ≤ 4096 caractères');
  }
  for (const message of messages) {
    assert.ok(message.embeds.length <= 10, '≤ 10 embeds par message');
    const total = message.embeds.reduce((sum, e) => sum + e.data.description.length, 0);
    assert.ok(total <= 6000, `total des embeds ≤ 6000 (obtenu ${total})`);
  }

  // Ordre chronologique global préservé malgré le découpage.
  const timestamps = fullText(messages)
    .split('\n')
    .filter(l => l.startsWith('- <t:'))
    .map(l => Number(l.match(/^- <t:(\d+):d>/)[1]));
  const trie = [...timestamps].sort((a, b) => a - b);
  assert.deepEqual(timestamps, trie, 'ordre chronologique conservé');

  // Chaque mois reste identifié, y compris sur les blocs de continuation.
  assert.ok(fullText(messages).includes('(suite)'), 'les mois découpés sont annotés');
});

test('le timestamp affiché est l’échéance réelle, minuit par défaut', () => {
  const avecHeure = devoir({ date: '2026-09-12', heure: '14:30' });
  const sansHeure = devoir({ date: '2026-09-12' });

  assert.equal(devoirsService.getDisplayDate(avecHeure).getHours(), 14);
  assert.equal(devoirsService.getDisplayDate(avecHeure).getMinutes(), 30);

  // Sans heure saisie : minuit (début du jour de l'échéance).
  assert.equal(devoirsService.getDisplayDate(sansHeure).getHours(), 0);
  assert.equal(devoirsService.getDisplayDate(sansHeure).getMinutes(), 0);

  // Le tableau et les rappels partagent exactement la même échéance.
  for (const d of [avecHeure, sansHeure]) {
    assert.equal(devoirsService.getDisplayDate(d).getTime(), devoirsService.getDeadline(d).getTime());
  }
});

// ---------------------------------------------------------------------------
// Jour J : un devoir reste listé toute la journée, même heure passée
// ---------------------------------------------------------------------------

/** Date AAAA-MM-JJ décalée de N jours. */
function dateInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('échéance du jour : « aujourd’hui » au lieu d’un compte à rebours négatif', () => {
  // 15h00 : les deux premiers ont leur heure passée, le troisième non.
  const maintenant = new Date();
  maintenant.setHours(15, 0, 0, 0);

  const items = [
    devoir({ titre: 'Minuit', date: dateInDays(0) }),               // 00:00 (défaut)
    devoir({ titre: 'Ce matin', date: dateInDays(0), heure: '08:00' }),
    devoir({ titre: 'Ce soir', date: dateInDays(0), heure: '23:00' }),
  ];

  const text = fullText(board.buildBoardMessages(items, maintenant));

  // Les trois sont présents...
  for (const titre of ['Minuit', 'Ce matin', 'Ce soir']) {
    assert.ok(text.includes(`→ ${titre}`), `${titre} doit rester affiché`);
  }

  // ...et aucun n'affiche de compte à rebours (qui serait négatif pour deux d'entre eux).
  assert.equal((text.match(/\*\*aujourd’hui\*\*/g) || []).length, 3);
  assert.ok(!text.includes(':R>'), 'aucun compte à rebours pour les échéances du jour');

  // La date reste affichée normalement.
  assert.match(text, /- <t:\d+:d> \(soit \*\*aujourd’hui\*\*\) : \*\*Cryptographie\*\* → Minuit/);
});

test('les échéances futures gardent le compte à rebours Discord vivant', () => {
  const maintenant = new Date();
  const items = [
    devoir({ titre: 'Demain', date: dateInDays(1) }),
    devoir({ titre: 'Semaine prochaine', date: dateInDays(7) }),
  ];

  const text = fullText(board.buildBoardMessages(items, maintenant));

  assert.equal((text.match(/:R>/g) || []).length, 2, 'les deux gardent <t:...:R>');
  assert.ok(!text.includes('aujourd’hui'));
});

test('« aujourd’hui » reste exact toute la journée (texte figé mais stable)', () => {
  const item = devoir({ titre: 'Aujourd’hui', date: dateInDays(0), heure: '08:00' });

  // Le tableau est reconstruit peu après minuit ; le rendu doit rester
  // identique quelle que soit l'heure de consultation dans la journée.
  const rendus = [0, 8, 15, 23].map(h => {
    const t = new Date();
    t.setHours(h, 30, 0, 0);
    return fullText(board.buildBoardMessages([item], t));
  });

  assert.equal(new Set(rendus).size, 1, 'le rendu ne dépend pas de l’heure de consultation');
  assert.ok(rendus[0].includes('**aujourd’hui**'));
});
