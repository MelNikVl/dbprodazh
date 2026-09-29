# Exact LTS version; application dependencies are locked by package-lock.json.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8050 CRM_SAMPLE_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server/index.mjs ./server/index.mjs
USER node
EXPOSE 8050
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8050/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
