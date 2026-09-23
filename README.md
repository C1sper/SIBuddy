# 4SIB Discord Bot

Bot Discord de classe développé en JavaScript (discord.js v14) : suivi des
devoirs et dates importantes, rappels automatiques, flux RSS, événements
récurrents, statistiques et réponses automatiques.

Le bot est **multi-serveur** : chaque serveur Discord possède ses propres
données, ses propres catégories et sa propre configuration.

## Prérequis

- Node.js **18 ou plus récent** (l'image Docker utilise Node 20)
- npm
- Une application bot sur le [Discord Developer Portal](https://discord.com/developers/applications)

## Installation

```bash
git clone <url-du-repository>
cd ESGI-3SI2-TEAM2
npm install
```

Créez un fichier `.env` à la racine :

```env
DISCORD_TOKEN=votre_token_bot_ici
CLIENT_ID=votre_client_id_ici
GUILD_ID=votre_guild_id_ici
```

> Le fichier `.env` est ignoré par Git. N'y placez jamais de secret dans un
> fichier versionné.

### Variables d'environnement

| Variable | Requis | Rôle |
|---|---|---|
| `DISCORD_TOKEN` | oui | Token du bot |
| `CLIENT_ID` | pour le déploiement | Application ID |
| `GUILD_ID` | non | Si défini, les commandes slash sont déployées sur ce seul serveur (immédiat, pratique en développement). Sinon, déploiement global (jusqu'à 1 h de propagation). |
| `RSS_INTERVAL_MS` | non | Intervalle de vérification des flux RSS (défaut : 5 min) |
| `LOG_LEVEL` | non | Verbosité : `error`, `warn`, `info` (défaut), `debug`, `silent` |
| `BOT_DATA_DIR` | non | Redirige tout le stockage vers un autre dossier. Utilisé par les tests — **à ne pas définir en production**. |

### Configuration Discord

1. Section **Bot** : copiez le token dans `.env`.
2. Section **General Information** : copiez l'Application ID (`CLIENT_ID`).
3. Section **Bot → Privileged Gateway Intents** : activez **Message Content
   Intent** et **Server Members Intent** (requis par `index.js`).

## Utilisation

```bash
npm run deploy   # déploie/actualise les commandes slash (à relancer après tout
                 # changement de signature d'une commande)
npm start        # démarre le bot
npm run dev      # démarrage avec rechargement automatique (nodemon)
npm test         # suite de tests (node --test, sans dépendance externe)
```

### Docker

```bash
docker compose build
docker compose up -d
docker compose logs -f
```

Le volume monté sur `/app/data` assure la persistance entre les `rebuild` et
les `recreate`. **Un seul montage suffit** : les sous-dossiers par serveur sont
créés automatiquement. Le dossier hôte doit être inscriptible par l'UID 1000
(utilisateur `node` du conteneur), y compris pour créer des sous-dossiers.

## Fonctionnalités

- **Dates importantes / devoirs** : ajout, modification, suppression,
  archivage automatique, priorités, matière, et heure limite facultative
  (**minuit par défaut**).
- **Tableau des dates importantes** : message auto-actualisé dans un salon
  dédié, regroupé par mois, avec comptes à rebours Discord vivants.
- **Rappels** : J-7, J-1, timings personnalisés (par serveur ou par devoir),
  en salon ou en message privé.
- **Catégories dynamiques** : propres à chaque serveur, gérées depuis le panel
  d'administration — aucune modification de code ni redéploiement nécessaire.
- **Flux RSS** : publication automatique des nouveaux articles.
- **Événements récurrents** : RSVP interactif et rappels (voir
  [EVENTS_SYSTEM.md](EVENTS_SYSTEM.md)).
- **Statistiques** de messages, par serveur.
- **Réponses automatiques** configurables (« quoi » → « Feur. »).
- **Panel d'administration** unique pour piloter l'ensemble.

## Commandes disponibles

### Dates importantes / devoirs

| Commande | Description |
|---|---|
| `/ajouter-devoir` | Ajoute une date importante (matière, nom, date, catégorie…) |
| `/liste-devoirs` | Liste les dates importantes du serveur |
| `/anciens-devoirs` | Liste les dates passées (archivées) |
| `/mp-rappel-devoir` | Planifie un rappel privé (DM) |
| `/modifier-date-devoir` 🔒 | Modifie la date limite |
| `/supprimer-devoir` 🔒 | Supprime une date importante |
| `/devoir-salon-liste` 🔒 | Définit le salon du tableau |
| `/devoir-salon-rappels` 🔒 | Définit le salon des rappels |
| `/devoir-mention-role-config` 🔒 | Définit le rôle mentionné dans les rappels |
| `/devoir-timings` 🔒 | Gère les timings de rappels du serveur |

### RSS

`/rss-setup` · `/rss-list` · `/rss-remove`

### Événements

`/event-create` · `/event-list` · `/event-edit` · `/event-delete` · `/event-stats`

### Utilitaires

`/ping` · `/help` · `/avatar` · `/poll` · `/roll` · `/anonymous` · `/stats` · `/mystats`

### Administration

`/admin-panel` 🔒 — point d'entrée unique : fonctionnalités activables,
gestion des devoirs (dont **modification complète**), gestion des
**catégories**, réponses automatiques, actualisation du tableau.

🔒 = nécessite la permission **Gérer le serveur**. Les panels revérifient cette
permission à **chaque** interaction, pas seulement à l'ouverture.

## Structure du projet

```
ESGI-3SI2-TEAM2/
├── commands/           # Commandes slash (events/, rss/, utility/)
├── events/             # Gestionnaires d'événements Discord (ready, interactionCreate…)
├── interactions/       # Panels Discord (admin, devoirs, catégories, feur)
├── services/           # Logique métier et accès aux données
├── utils/              # Utilitaires et helpers
├── scripts/            # Scripts de maintenance (migration de données)
├── tests/              # Tests (node --test)
├── data/               # Données persistantes (non versionnées)
├── index.js            # Point d'entrée
├── deploy-commands.js  # Déploiement des commandes slash
├── Dockerfile
└── docker-compose.yml
```

## Stockage des données

Les données sont rangées **par serveur Discord** (schéma v2) :

```
data/
├── schema.json                     version du format de données
├── guilds/<guildId>/
│   ├── config.json                 fonctionnalités, réponses auto, salons, rôle, timings
│   ├── categories.json             catégories propres au serveur
│   ├── devoirs.json
│   ├── devoirs-archives.json
│   ├── reminders.json
│   ├── stats.json
│   ├── rss-config.json
│   ├── rss-state.json
│   └── events.json
└── global/                         données réellement globales au bot
```

Tous les accès passent par `services/guildStore.js` (validation du `guildId`,
écriture atomique, mise en quarantaine des fichiers illisibles) : **aucune
commande ne construit de chemin de fichier**. Changer de mode de stockage plus
tard ne demande de réécrire que ce module.

Le dossier d'un serveur est créé automatiquement à la première utilisation.
Quand le bot quitte un serveur, ses données sont **conservées** (nettoyage
manuel uniquement), pour qu'un retrait accidentel ne détruise rien.

### Migration depuis l'ancien format

Les installations antérieures stockaient tout à plat dans `data/*.json`. Le
script de migration éclate ces données par serveur :

```bash
# 1. Simulation : n'écrit rien, affiche ce qui serait fait
node scripts/migrate-data-v2.js --dry-run

# 2. Migration réelle (sauvegarde automatique préalable)
node scripts/migrate-data-v2.js
```

Si d'anciennes données ne contiennent aucun `guildId` exploitable, le script
s'arrête et demande à quel serveur les rattacher — il ne devine jamais :

```bash
node scripts/migrate-data-v2.js --guild-id <DISCORD_GUILD_ID> --dry-run
node scripts/migrate-data-v2.js --guild-id <DISCORD_GUILD_ID>
```

La migration crée une sauvegarde complète dans `data/backups/migration-<date>/`
(jamais écrasée ; à l'intérieur du volume, donc conservée aussi quand la
migration est lancée depuis le conteneur), valide les données relues, est idempotente, et **ne supprime
jamais les anciens fichiers**.

## Logs

Le bot écrit ses logs sur la sortie standard, une ligne par événement :

```
2026-09-08 10:23:45  INFO  [bot] 27 commande(s) chargée(s).
2026-09-08 10:24:02  INFO  [interactions] /ping — arthus dans 4SIB (48ms)
2026-09-08 10:24:19  WARN  [rssRunner] Salon indisponible pour le flux Actus
2026-09-08 10:25:01  ERROR [DevoirBoard] Envoi impossible: Missing Permissions
```

`error` et `warn` partent sur `stderr`, `info` et `debug` sur `stdout`.

| `LOG_LEVEL` | Ce qui s'affiche |
|---|---|
| `silent` | rien |
| `error` | erreurs uniquement |
| `warn` | + avertissements |
| `info` | **(défaut)** + démarrage, commandes exécutées, rappels envoyés |
| `debug` | + détail par module et stack traces complètes |

```bash
docker compose logs -f --tail 100          # suivre
docker compose logs | grep 'ERROR'         # erreurs seulement
docker compose logs | grep '\[rssRunner\]'  # un module
```

### Rotation des logs

Aucune rotation n'est configurée dans `docker-compose.yml`, **volontairement** :
un bloc `logging:` par conteneur vide l'onglet Journal de Container Manager sur
Synology DSM (`docker logs` continue pourtant de fonctionner en SSH).

Ce n'est pas gênant : au niveau `info`, ce bot produit de l'ordre de 2 à 8 Mo
de logs par an. Si une rotation devient nécessaire, la configurer au niveau du
démon — ce qui n'affecte pas l'affichage DSM :

```bash
# Synology DSM 7 (Container Manager)
sudo vi /var/packages/ContainerManager/etc/dockerd.json
```
```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```
```bash
sudo synosystemctl restart pkgctl-ContainerManager
```

## Tests

```bash
npm test
```

Les tests utilisent le lanceur intégré de Node (`node --test`, aucune
dépendance). Chaque fichier de test travaille dans un dossier `data/` temporaire
isolé : **ils ne touchent jamais aux données réelles**.

## Contribution

1. Forkez le projet
2. Créez une branche (`git checkout -b feature/ma-fonctionnalite`)
3. Vérifiez que `npm test` passe
4. Committez vos changements
5. Ouvrez une Pull Request

## Licence

Projet sous licence MIT.

## Support

Pour toute question ou problème, ouvrez une issue sur ce repository.
