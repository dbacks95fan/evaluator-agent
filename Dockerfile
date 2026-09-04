FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY schemas ./schemas
RUN npm run build && npm prune --omit=dev && npm install --global @openai/codex

FROM node:20-bookworm-slim
WORKDIR /app
# Codex's native TLS client relies on the operating system trust store, not Node's bundled CAs.
RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/schemas ./schemas
COPY --from=build /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex \
  && useradd --system --uid 10001 --create-home evaluator
USER evaluator
EXPOSE 8080
CMD ["node", "dist/service.js"]
