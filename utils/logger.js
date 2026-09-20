// utils/logger.js
// Logger centralisé du bot.
//
// Sortie : une ligne par événement, horodatée et préfixée par son niveau et
// son module, pour rester lisible ET filtrable dans `docker compose logs`.
//
//   2026-09-08 10:23:45  INFO  [interactions] /ping par arthus#0001
//   2026-09-08 10:23:47  WARN  [rssRunner] Salon indisponible pour le flux Actus
//   2026-09-08 10:23:49  ERROR [DevoirBoard] Envoi impossible: Missing Permissions
//
// Niveaux, du plus grave au plus verbeux :
//   error < warn < info < debug
// LOG_LEVEL choisit le seuil affiché (défaut : "info"). "silent" coupe tout.
//
// error et warn partent sur stderr, info et debug sur stdout : les erreurs
// restent isolables (`docker compose logs 2>/dev/null` ne montre que le reste).

const fs = require('fs');

const LEVELS = { silent: -1, error: 0, warn: 1, info: 2, debug: 3 };

// Descripteurs standard. On écrit dedans avec fs.writeSync plutôt qu'avec
// process.stdout.write : quand la sortie est un tube (docker logs, `| tee`,
// nodemon), Node bufferise les écritures et un process.exit() immédiat — celui
// du handler uncaughtException ou de l'arrêt sur SIGTERM — les perd. Le bot
// mourait alors sans le moindre message, en local comme dans le conteneur.
const STDOUT_FD = 1;
const STDERR_FD = 2;

function writeLine(fd, line) {
  const stream = fd === STDERR_FD ? process.stderr : process.stdout;

  // Terminal : on passe par process.stdout/stderr. Node y convertit le texte
  // vers l'encodage de la console — indispensable sur la console Windows, où
  // l'UTF-8 brut s'afficherait en mojibake ("événement" -> "├®v├®nement").
  if (stream && stream.isTTY) {
    try {
      stream.write(line);
    } catch { /* terminal fermé : on abandonne cette ligne */ }
    return;
  }

  // Tube ou fichier (docker logs, nodemon, redirection) : fs.writeSync
  // garantit que rien n'est perdu si le process s'arrête juste après, ce que
  // font les handlers uncaughtException et SIGTERM.
  try {
    fs.writeSync(fd, line);
  } catch (e) {
    // EAGAIN : tube momentanément plein, une seule reprise suffit.
    // EPIPE : la sortie est fermée, il n'y a plus rien à faire.
    if (e && e.code === 'EAGAIN') {
      try { fs.writeSync(fd, line); } catch { /* on abandonne cette ligne */ }
    }
  }
}
const DEFAULT_LEVEL = 'info';

// Lu à chaque appel (et non au chargement du module) pour que le niveau
// puisse être changé à chaud, notamment dans les tests.
function currentLevelName() {
  const raw = String(process.env.LOG_LEVEL || '').toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(LEVELS, raw) ? raw : DEFAULT_LEVEL;
}

function isEnabled(level) {
  return LEVELS[level] <= LEVELS[currentLevelName()];
}

function timestamp() {
  const d = new Date();
  const p = (n, size = 2) => String(n).padStart(size, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * Rend un argument lisible. Les Error sont réduites à leur message :
 * la stack complète est ajoutée séparément (voir emit), pour ne pas noyer
 * la ligne principale.
 */
function formatArg(arg) {
  if (arg instanceof Error) return arg.message;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function emit(level, scope, args) {
  if (!isEnabled(level)) return;

  const parts = args.map(formatArg).filter(part => part !== '');
  const prefix = `${timestamp()}  ${level.toUpperCase().padEnd(5)} ${scope ? `[${scope}] ` : ''}`;
  const line = `${prefix}${parts.join(' ')}`;

  // error et warn sur stderr, le reste sur stdout.
  writeLine(LEVELS[level] <= LEVELS.warn ? STDERR_FD : STDOUT_FD, `${line}\n`);

  // La stack n'est conservée que pour les erreurs, et seulement en debug :
  // en exploitation normale le message suffit, en investigation on veut tout.
  if (level === 'error' && isEnabled('debug')) {
    for (const arg of args) {
      if (arg instanceof Error && arg.stack) writeLine(STDERR_FD, `${arg.stack}\n`);
    }
  }
}

/**
 * Logger rattaché à un module.
 *   const log = createLogger('DevoirBoard');
 *   log.info('Tableau actualisé');
 *   log.error('Envoi impossible', error);
 */
function createLogger(scope) {
  return {
    error: (...args) => emit('error', scope, args),
    warn: (...args) => emit('warn', scope, args),
    info: (...args) => emit('info', scope, args),
    debug: (...args) => emit('debug', scope, args),
  };
}

const root = createLogger(null);

module.exports = {
  LEVELS,
  createLogger,
  currentLevelName,
  isEnabled,
  error: root.error,
  warn: root.warn,
  info: root.info,
  // Conservé : `debug()` et `isDebug()` étaient l'ancienne API publique.
  debug: root.debug,
  isDebug: () => isEnabled('debug'),
};
