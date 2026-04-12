# ── Stage 1: Install deps ─────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/wow-constants/package.json packages/wow-constants/

RUN npm ci --workspace=@mplus/web --workspace=@mplus/types --workspace=@mplus/wow-constants --include-workspace-root

# ── Stage 2: Build ────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/ apps/web/
COPY packages/types/ packages/types/
COPY packages/wow-constants/ packages/wow-constants/

WORKDIR /app/apps/web

ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

# ── Stage 3: Run ──────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
