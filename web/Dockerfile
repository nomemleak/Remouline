# Dashboard + admin panel (Next.js standalone server). Built by docker-compose; the
# app name and time zone are baked in at build time (NEXT_PUBLIC_*).
FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_APP_NAME=Remouline
ARG NEXT_PUBLIC_TIMEZONE=UTC
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME NEXT_PUBLIC_TIMEZONE=$NEXT_PUBLIC_TIMEZONE NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
