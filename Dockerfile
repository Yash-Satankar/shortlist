# One image runs the whole app: Express API + built web app (+ background jobs later).
# Railway: pre-deploy runs migrations with this image; the start command runs the server.

# ---- build: install everything, build web + api, then drop dev dependencies
FROM node:24-bookworm-slim AS build
ENV CI=true
RUN npm install -g pnpm@10.34.6
WORKDIR /app

# Manifests first so the dependency layer is cached between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
# Build with dev deps, then reinstall production deps only (pnpm prune drops workspace links).
RUN pnpm build \
 && rm -rf node_modules apps/*/node_modules packages/*/node_modules \
 && pnpm install --frozen-lockfile --prod

# ---- runtime: only what's needed to run (no sources, no dev deps, no secrets)
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
