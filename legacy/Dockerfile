FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/connectors/package.json ./packages/connectors/
COPY packages/agents/package.json ./packages/agents/
COPY packages/scheduler/package.json ./packages/scheduler/
COPY apps/dashboard/package.json ./apps/dashboard/
RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY . .
RUN pnpm --filter @agent-hub/core build \
 && pnpm --filter @agent-hub/connectors build \
 && pnpm --filter @agent-hub/agents build \
 && pnpm --filter @agent-hub/scheduler build

FROM base AS scheduler
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
CMD ["pnpm", "--filter", "@agent-hub/scheduler", "start"]
