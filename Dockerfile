# LearnIT API + background worker for Google Cloud Run (asia-south1, Mumbai).
# The frontend is built and served by Vercel; this image contains only the API.
#
#   docker build -t learnit-api .
#   docker run -p 8080:8080 --env-file .env learnit-api

# ── Build: bundle server.ts with esbuild ──────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
# vendor/ holds packages not published on npm (SheetJS xlsx).
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run build:server

# ── Runtime: production dependencies + the bundle, as a non-root user ─────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 8080
# Run node directly (not npm) so SIGTERM from Cloud Run reaches the server and
# running jobs can finish before the instance stops.
CMD ["node", "dist-server/server.js"]
