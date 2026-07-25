FROM node:22-alpine AS build
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
RUN pnpm --filter @ros/api... build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=staging
COPY --from=build /app /app
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
