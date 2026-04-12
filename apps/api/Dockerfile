# syntax=docker/dockerfile:1
#
# M+ Platform API — production image.
#
# Runs TypeScript directly via tsx. This deliberately avoids a compile
# step so that workspace package imports (@mplus/*) resolve cleanly
# without the complexity of conditional exports or per-package build
# outputs. The runtime cost of tsx is negligible for a long-lived
# Fastify server.
#

FROM node:20-alpine
WORKDIR /app

# System deps
#   - libc6-compat: prisma/node native modules on Alpine
#   - openssl: prisma runtime requirement
RUN apk add --no-cache libc6-compat openssl

# Install workspace manifests first for layer caching
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/companion/package.json apps/companion/
COPY packages/types/package.json packages/types/
COPY packages/wow-constants/package.json packages/wow-constants/

# Skip heavy platform-specific downloads we don't need in the API image.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1

# --ignore-scripts avoids prisma's postinstall attempting to connect
# to a DB we don't have yet (we'll generate explicitly below).
RUN npm ci --ignore-scripts

# Copy the source tree
COPY . .

# Generate Prisma client (doesn't need DB connectivity)
WORKDIR /app/apps/api
RUN npx prisma generate --schema prisma/schema.prisma

# Entrypoint (runs migrations then starts tsx)
RUN chmod +x docker-entrypoint.sh

WORKDIR /app

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD wget -qO- http://localhost:3001/health || exit 1

ENTRYPOINT ["/app/apps/api/docker-entrypoint.sh"]
