FROM node:20-alpine

WORKDIR /app

# Dépendances d'abord pour profiter du cache Docker sur les rebuilds
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Le dossier data/ doit exister avant le premier démarrage. Les sous-dossiers
# du schéma v2 (data/guilds/<guildId>/ et data/global/) sont créés à la volée
# par services/guildStore.js : un seul volume monté sur /app/data suffit,
# aucun montage supplémentaire par serveur Discord n'est nécessaire.
RUN mkdir -p /app/data/guilds /app/data/global && chown -R node:node /app

# L'image officielle node fournit déjà un utilisateur non-root "node".
USER node

ENV NODE_ENV=production
ENV TZ=Europe/Paris

CMD ["node", "index.js"]
