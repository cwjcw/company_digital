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
COPY packages/database/package.json packages/database/package.json
COPY packages/permissions/package.json packages/permissions/package.json
COPY packages/plugin-sdk/package.json packages/plugin-sdk/package.json
COPY packages/ai-tool-sdk/package.json packages/ai-tool-sdk/package.json
COPY packages/workflow-sdk/package.json packages/workflow-sdk/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/shared packages/shared
COPY packages/contracts packages/contracts
COPY packages/database packages/database
COPY packages/permissions packages/permissions
COPY packages/plugin-sdk packages/plugin-sdk
COPY packages/ai-tool-sdk packages/ai-tool-sdk
COPY packages/workflow-sdk packages/workflow-sdk
RUN pnpm --filter @tracker/shared --filter @kdos/contracts --filter @kdos/database --filter @kdos/permissions --filter @kdos/plugin-sdk --filter @kdos/ai-tool-sdk --filter @kdos/workflow-sdk build && pnpm --filter @tracker/api build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app/apps/api

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist
COPY --from=build /app/packages/contracts /app/packages/contracts
COPY --from=build /app/packages/database /app/packages/database
COPY --from=build /app/packages/permissions /app/packages/permissions
COPY --from=build /app/packages/plugin-sdk /app/packages/plugin-sdk
COPY --from=build /app/packages/ai-tool-sdk /app/packages/ai-tool-sdk
COPY --from=build /app/packages/workflow-sdk /app/packages/workflow-sdk

USER node
EXPOSE 15173
CMD ["node", "dist/main.js"]
