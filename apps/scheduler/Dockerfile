# syntax=docker/dockerfile:1
#
# M+ Platform Ready Check scheduler — production image.
#
# Tiny worker process that ticks the RC expiry + group-timeout sweep
# endpoints on a recurring interval. Runs tsx directly for consistency
# with the other runtime images in this monorepo.
#

FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/companion/package.json apps/companion/
COPY apps/scheduler/package.json apps/scheduler/
COPY packages/types/package.json packages/types/
COPY packages/wow-constants/package.json packages/wow-constants/

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1

RUN npm ci --ignore-scripts

COPY . .

ENV NODE_ENV=production

CMD ["npx", "tsx", "apps/scheduler/src/index.ts"]
