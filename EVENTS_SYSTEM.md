# 🎪 Système d'Événements Serveur Automatisés

## Vue d'ensemble

Le système d'événements est une fonctionnalité complète qui permet de créer, gérer et suivre des événements communautaires sur votre serveur Discord. Il inclut un système RSVP interactif, des rappels automatiques, et la gestion d'événements récurrents.

## ✨ Fonctionnalités principales

### 📅 Création d'événements
- **Commande:** `/event-create`
- Création d'événements avec titre, description, date/heure
- Limite de participants configurable
- Support des événements récurrents (hebdomadaire/mensuel)
- Intégration avec les événements Discord natifs

### 👥 Système RSVP interactif
- Boutons interactifs pour confirmer la participation
- Options : "Je participe", "Peut-être", "Je ne peux pas"
- Mise à jour en temps réel du nombre de participants
- Prévention des doublons de participation

### 📋 Gestion des événements
- **Commande:** `/event-list` - Liste tous les événements (à venir/passés)
- **Commande:** `/event-edit` - Modifier un événement existant
- **Commande:** `/event-delete` - Supprimer un événement avec confirmation
- **Commande:** `/event-stats` - Statistiques détaillées du serveur

### 🔔 Rappels automatiques
- Rappels programmés à 24h, 1h et 15min avant l'événement
- Notifications personnalisées par utilisateur
- Rappels dans le canal de l'événement
- Gestion automatique des fuseaux horaires

### 🔄 Événements récurrents
- Événements hebdomadaires (même jour de la semaine)
- Événements mensuels (même date du mois)
- Création automatique des prochaines occurrences
- Gestion intelligente des conflits de dates

## 🚀 Commandes disponibles

### `/event-create`
Crée un nouvel événement avec système RSVP.

**Paramètres obligatoires :**
- `titre` : Nom de l'événement (max 100 caractères)
- `description` : Description détaillée (max 1000 caractères)
- `date` : Date au format DD/MM/YYYY
- `heure` : Heure au format HH:MM

**Paramètres optionnels :**
- `limite` : Nombre max de participants (défaut: 50)
- `canal` : Canal pour l'annonce (défaut: canal actuel)
- `recurrence` : Type de récurrence (aucune/hebdomadaire/mensuelle)

**Exemple :**
```
/event-create titre:"Réunion équipe" description:"Réunion hebdomadaire de l'équipe dev" date:"25/10/2025" heure:"14:30" limite:20 recurrence:hebdomadaire
```

### `/event-list`
Affiche la liste des événements du serveur avec navigation interactive.

**Paramètres optionnels :**
- `statut` : Filtrer par statut (tous/à-venir/passés)
- `limite` : Nombre d'événements par page (défaut: 5)

### `/event-edit`
Modifie un événement existant (créateur ou admin seulement).

**Paramètres :**
- `event-id` : ID de l'événement à modifier (obligatoire)
- Tous les autres paramètres sont optionnels

### `/event-delete`
Supprime un événement avec confirmation (créateur ou admin seulement).

**Paramètres :**
- `event-id` : ID de l'événement à supprimer
- `force` : Suppression sans confirmation (admin seulement)

### `/event-stats`
Affiche les statistiques complètes du système d'événements.

## 🎯 Interface utilisateur

### Boutons RSVP
Chaque événement affiche 4 boutons interactifs :
- **✅ Je participe** : Confirme la participation
- **❓ Peut-être** : Marque comme "peut-être"
- **❌ Je ne peux pas** : Décline la participation
- **ℹ️ Détails** : Affiche les informations complètes

### Embeds informatifs
- Affichage en temps réel des participants
- Compte à rebours jusqu'à l'événement
- Informations sur la récurrence
- Statut de l'utilisateur actuel

## 🔧 Configuration et permissions

### Permissions requises
- **Créer des événements :** Permission "Gérer les événements" ou "Administrateur"
- **Modifier/Supprimer :** Créateur de l'événement ou permissions admin
- **Participer :** Tous les membres du serveur

### Limites par défaut
- **Événements par serveur :** 50 maximum
- **Participants par événement :** 100 maximum
- **Occurrences futures :** 4 pour les événements récurrents

### Intents Discord requis
```javascript
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.GuildMembers
```

## 📁 Structure des fichiers

```
commands/events/
├── create.js          # Création d'événements
├── list.js            # Liste des événements
├── edit.js            # Modification d'événements
├── delete.js          # Suppression d'événements
└── stats.js           # Statistiques

utils/
└── eventInteractions.js    # Gestion des boutons RSVP

services/
├── reminderSystem.js       # Système de rappels automatiques
├── recurringEvents.js      # Gestion des événements récurrents
└── eventsConfigStore.js    # Accès aux données (par serveur)

data/guilds/<guildId>/events.json    # Événements, par serveur Discord
data/global/events-settings.json     # Réglages partagés (limites, rappels par défaut)
```

## 🗄️ Structure de données

### Événement
```json
{
  "id": "guildId_timestamp_random",
  "guildId": "123456789",
  "channelId": "987654321",
  "creatorId": "456789123",
  "title": "Titre de l'événement",
  "description": "Description détaillée",
  "dateTime": "2025-10-25T14:30:00.000Z",
  "maxParticipants": 50,
  "recurrence": "weekly",
  "participants": {
    "attending": ["userId1", "userId2"],
    "maybe": ["userId3"],
    "notAttending": ["userId4"]
  },
  "createdAt": "2025-10-23T10:00:00.000Z",
  "messageId": "message_id",
  "discordEventId": "discord_event_id"
}
```

## 🔔 Système de rappels

### Types de rappels
1. **24h avant** : Rappel général avec détails complets
2. **1h avant** : Rappel urgent
3. **15min avant** : Rappel final "ça commence bientôt"

### Fonctionnement
- Programmation automatique lors de la création
- Envoi en DM aux participants confirmés et "peut-être"
- Message dans le canal de l'événement
- Reprogrammation automatique lors des modifications

## 🔄 Événements récurrents

### Types supportés
- **Hebdomadaire** : Même jour de la semaine, même heure
- **Mensuel** : Même date du mois, même heure

### Gestion automatique
- Création des prochaines occurrences quand l'événement de base est passé
- Maximum 4 occurrences futures créées à l'avance
- Nettoyage automatique des anciennes occurrences
- Gestion des mois avec moins de jours (ex: 31 février → 28/29 février)

## 📊 Statistiques disponibles

- Nombre total d'événements (à venir/passés/récurrents)
- Taux de participation moyen
- Événement le plus populaire
- Créateurs les plus actifs
- Activité mensuelle
- Statistiques du système de rappels

## 🚨 Gestion d'erreurs

### Validation des données
- Vérification des formats de date/heure
- Validation des limites de participants
- Contrôle des permissions utilisateur

### Récupération automatique
- Rechargement des événements au démarrage
- Reprogrammation des rappels après redémarrage
- Nettoyage automatique des données expirées

## 🔧 Maintenance

### Tâches automatiques
- **Toutes les heures :** Nettoyage des rappels expirés
- **Toutes les heures :** Création d'occurrences récurrentes
- **Au démarrage :** Rechargement et reprogrammation des rappels

### Fichiers de configuration
- `data/guilds/<guildId>/events.json` : événements du serveur — chaque serveur
  Discord possède les siens, aucune donnée n'est partagée entre serveurs
- `data/global/events-settings.json` : réglages communs au bot
  (`maxEventsPerGuild`, `maxParticipantsPerEvent`, rappels par défaut)
- Accès centralisé via `services/eventsConfigStore.js` : écriture atomique,
  sauvegarde automatique après chaque modification
- Format JSON lisible et modifiable manuellement

## 🎉 Utilisation recommandée

### Pour les administrateurs
1. Créer des événements récurrents pour les activités régulières
2. Utiliser les statistiques pour analyser l'engagement
3. Configurer des limites appropriées selon la taille du serveur

### Pour les membres
1. Utiliser les boutons RSVP pour confirmer la participation
2. Consulter les détails via le bouton "ℹ️"
3. Modifier son statut à tout moment avant l'événement

### Bonnes pratiques
- Créer les événements suffisamment à l'avance
- Utiliser des descriptions claires et détaillées
- Définir des limites de participants réalistes
- Vérifier régulièrement les statistiques d'engagement

## 🐛 Dépannage

### Problèmes courants
- **Rappels non envoyés :** Vérifier les permissions DM des utilisateurs
- **Événements Discord non créés :** Vérifier les permissions du bot
- **Boutons non fonctionnels :** Redémarrer le bot pour recharger les interactions

### Logs utiles
- Création/modification/suppression d'événements
- Envoi de rappels et notifications
- Erreurs de permissions ou de validation

---

*Système développé pour le bot Discord 4SIB - Version 1.0*
