# Build from this folder: docker build -t fitzymate .
# The match runs it with no network, a read-only root (writable /tmp), 1 CPU, 512 MB, and the map at /arena.
FROM node:22.17.1-bookworm-slim
WORKDIR /bot
COPY main.mjs ./
COPY src ./src
# fallback copy of the map, used only if /arena cannot be read
COPY arena ./arena
ENV NODE_ENV=production
ENTRYPOINT ["node", "--max-old-space-size=320", "/bot/main.mjs"]
