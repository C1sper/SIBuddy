// index.js
require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('./utils/logger');

const log = createLogger('bot');

// 1) Création du client avec les intents nécessaires
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// stocker les commandes
client.commands = new Collection();

// 2) Charger automatiquement tous les events du dossier ./events
const eventsPath = path.join(__dirname, 'events');
let loadedEvents = 0;
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

  for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    if (!event?.name || typeof event.execute !== 'function') {
      log.warn(`Event invalide : ${file} (doit exporter { name, execute, once? })`);
      continue;
    }

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }

    log.debug(`Événement chargé : ${event.name}`);
    loadedEvents++;
  }

  log.info(`${loadedEvents} événement(s) chargé(s).`);
}

// 3) Charger les commandes (slash) depuis ./commands/**
const foldersPath = path.join(__dirname, 'commands');
let loadedCommands = 0;
if (fs.existsSync(foldersPath)) {
  const commandFolders = fs.readdirSync(foldersPath);

  for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    if (!fs.lstatSync(commandsPath).isDirectory()) continue;

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);

      if (command?.data?.name && typeof command.execute === 'function') {
        client.commands.set(command.data.name, command);
        loadedCommands++;
        log.debug(`Commande chargée : ${command.data.name}`);
      } else {
        log.warn(`Commande ignorée : ${filePath} manque "data.name" ou "execute".`);
      }
    }
  }

  log.info(`${loadedCommands} commande(s) chargée(s).`);
}

// 4) Gestion des erreurs
process.on('unhandledRejection', error => {
  log.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
  log.error('Uncaught exception:', error);
  process.exit(1);
});

// 5) Arrêt propre (Docker envoie SIGTERM) : on sauvegarde les données en attente
const statsStore = require('./services/statsStore');
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Signal ${signal} reçu, arrêt en cours...`);
  statsStore.forceFlush();
  client.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 6) Connexion
client.login(process.env.DISCORD_TOKEN);
