# Migrates the dummy database, then fills it and the bucket. Built from the repository root: it
# needs the backend's source beside the seed, for its Prisma schema, its migrations and its own
# analytics seed.
FROM node:22-alpine

WORKDIR /stack/backend
COPY backend/package.json backend/package-lock.json backend/prisma.config.ts ./
# The source files prisma.config.ts imports.
COPY backend/src/config/env.ts ./src/config/env.ts
COPY backend/src/prisma/database-url.ts ./src/prisma/database-url.ts
COPY backend/prisma ./prisma
RUN npm ci --no-audit --no-fund && npx prisma generate

COPY backend/ ./
COPY seed/ /stack/seed/
# The seed sits beside the backend, as in the repository, and resolves its packages from it.
RUN ln -s /stack/backend/node_modules /stack/node_modules

CMD ["npx", "tsx", "../seed/main.ts"]
