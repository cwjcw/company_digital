FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/permissions/package.json packages/permissions/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/shared packages/shared
COPY packages/contracts packages/contracts
COPY packages/permissions packages/permissions
RUN pnpm --filter @tracker/shared --filter @kdos/contracts --filter @kdos/permissions build && pnpm --filter @tracker/web build

FROM nginx:1.28-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
