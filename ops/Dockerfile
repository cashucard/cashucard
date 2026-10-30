# syntax=docker/dockerfile:1
# Pin the multi-platform index so both native build targets use the same release.
FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/tools/cardkit
COPY tools/cardkit/ ./
RUN yarn install --frozen-lockfile && yarn build
WORKDIR /app/ops
COPY ops/package.json ops/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY ops/tsconfig*.json ./
COPY ops/src ./src
RUN yarn build

FROM build AS production-dependencies
RUN rm -rf node_modules /app/tools/cardkit/node_modules && yarn install --frozen-lockfile --production && yarn cache clean

FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS runtime
ARG VERSION=0.1.0
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Cashu Card ops-service" \
      org.opencontainers.image.source="https://github.com/cashucard/cashucard" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$REVISION
ENV NODE_ENV=production OPS_HOST=0.0.0.0 OPS_PORT=8821 OPS_DB=/data/ops.sqlite
WORKDIR /app/ops
COPY --from=production-dependencies /app/ops/node_modules ./node_modules
COPY --from=build /app/ops/dist ./dist
COPY ops/docker/healthcheck.cjs ./healthcheck.cjs
COPY LICENSE ./LICENSE
RUN mkdir /data /backups /secrets && chown node:node /data /backups /secrets && chmod 700 /data /backups /secrets
USER node
EXPOSE 8821
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "healthcheck.cjs"]
ENTRYPOINT ["node", "dist/standalone.js"]
CMD ["serve"]
