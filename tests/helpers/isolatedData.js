// tests/helpers/isolatedData.js
// Chaque fichier de test travaille dans son propre dossier data/ jeté après
// coup : aucun test ne peut toucher aux données réelles du bot.
//
// À appeler AVANT tout require de services/ (le chemin de data/ est résolu
// au chargement du module dataStore).
const fs = require('fs');
const os = require('os');
const path = require('path');

function useIsolatedDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-test-data-'));
  process.env.BOT_DATA_DIR = dir;

  // Les tests vérifient des comportements, pas des messages de log : on coupe
  // la sortie pour garder le rapport de test lisible.
  if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'silent';

  process.on('exit', () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* déjà nettoyé */ }
  });

  return dir;
}

// Deux serveurs Discord fictifs, avec de vrais formats de snowflake.
const GUILD_A = '100000000000000001';
const GUILD_B = '200000000000000002';

module.exports = { useIsolatedDataDir, GUILD_A, GUILD_B };
