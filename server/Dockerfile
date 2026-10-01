# One image for the three backend services (api, webhook, worker);
# docker-compose picks the entrypoint.
FROM node:22-bookworm-slim

# git: the worker clones pushes.
# docker CLI: the worker drives the HOST Docker daemon through its socket.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apt-get purge -y make g++ && apt-get autoremove -y
COPY src ./src

ENV NODE_ENV=production
CMD ["node", "src/api/server.js"]
