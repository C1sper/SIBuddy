// utils/devoirAutocomplete.js
// Autocomplétion partagée par /supprimer-devoir, /modifier-date-devoir et
// /mp-rappel-devoir.
//
// Point critique multi-serveur : la liste est TOUJOURS restreinte au serveur
// de l'interaction. Auparavant, deux de ces commandes proposaient les devoirs
// de tous les serveurs, ce qui permettait d'en supprimer un depuis un autre.
const devoirsService = require('../services/devoirsService');
const categoriesService = require('../services/categoriesService');

const MAX_CHOICES = 25; // limite Discord

/** Libellé lisible d'un devoir : "1. [📚 Devoir] Cryptographie — TP RSA (2026-09-12)". */
function formatChoiceName(devoir, guildId, index) {
  const category = devoirsService.getDevoirCategory(guildId, devoir);
  const categoryLabel = category ? categoriesService.formatCategory(category) : 'Sans catégorie';
  const subject = devoir.matiere ? `${devoir.matiere} — ${devoir.titre}` : devoir.titre;
  const echeance = devoirsService.formatEcheance(devoir);

  return `${index + 1}. [${categoryLabel}] ${subject} (${echeance})`.slice(0, 100);
}

/**
 * Répond à une interaction d'autocomplétion avec les devoirs du serveur courant.
 * La valeur renvoyée est l'ID stable du devoir (toujours en chaîne).
 */
async function respondWithDevoirs(interaction) {
  if (!interaction.guildId) return interaction.respond([]);

  const focused = String(interaction.options.getFocused() || '').toLowerCase();

  const devoirs = devoirsService
    .getUpcoming(interaction.guildId)
    .filter(d => {
      if (!focused) return true;
      return `${d.matiere} ${d.titre} ${d.date}`.toLowerCase().includes(focused);
    })
    .slice(0, MAX_CHOICES);

  return interaction.respond(
    devoirs.map((d, index) => ({
      name: formatChoiceName(d, interaction.guildId, index),
      value: String(d.id),
    })),
  );
}

/** Répond avec les catégories du serveur courant (actives uniquement par défaut). */
async function respondWithCategories(interaction, options) {
  if (!interaction.guildId) return interaction.respond([]);
  return interaction.respond(
    categoriesService.buildAutocompleteChoices(
      interaction.guildId,
      interaction.options.getFocused(),
      options,
    ),
  );
}

module.exports = { respondWithDevoirs, respondWithCategories, formatChoiceName, MAX_CHOICES };
