FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS base

# Pin the runtime crypto libraries to the Alpine security release that fixes
# the OpenSSL 3.5.7 findings reported for the previous candidate image.
RUN apk add --no-cache --upgrade \
      libcrypto3=3.5.8-r0 \
      libssl3=3.5.8-r0

FROM base AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/observability/package.json packages/observability/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages packages
COPY database/migrations database/migrations
RUN pnpm --filter @ros/api... build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=staging
COPY --from=build /app /app
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
