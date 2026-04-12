# syntax=docker/dockerfile:1
#
# M+ Platform Discord bot — production image.
#
# Runs TypeScript directly via tsx for the same monorepo workspace
# resolution reasons as the API image. No exposed ports — the bot
# connects out to Discord's gateway.
#

FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/companion/package.json apps/companion/
COPY packages/types/package.json packages/types/
COPY packages/wow-constants/package.json packages/wow-constants/

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1

RUN npm ci --ignore-scripts

COPY . .

ENV NODE_ENV=production

CMD ["npx", "tsx", "apps/bot/src/index.ts"]
