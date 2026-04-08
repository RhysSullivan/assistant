FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# Dependencies - cached when package.json files unchanged
FROM base AS deps
COPY --link bun.lock package.json ./
COPY --link packages/core/api/package.json ./packages/core/api/
COPY --link packages/core/config/package.json ./packages/core/config/
COPY --link packages/core/execution/package.json ./packages/core/execution/
COPY --link packages/core/sdk/package.json ./packages/core/sdk/
COPY --link packages/core/storage-file/package.json ./packages/core/storage-file/
COPY --link packages/core/storage-postgres/package.json ./packages/core/storage-postgres/
COPY --link packages/hosts/mcp/package.json ./packages/hosts/mcp/
COPY --link packages/kernel/core/package.json ./packages/kernel/core/
COPY --link packages/kernel/ir/package.json ./packages/kernel/ir/
COPY --link packages/kernel/runtime-deno-subprocess/package.json ./packages/kernel/runtime-deno-subprocess/
COPY --link packages/kernel/runtime-quickjs/package.json ./packages/kernel/runtime-quickjs/
COPY --link packages/plugins/file-secrets/package.json ./packages/plugins/file-secrets/
COPY --link packages/plugins/google-discovery/package.json ./packages/plugins/google-discovery/
COPY --link packages/plugins/graphql/package.json ./packages/plugins/graphql/
COPY --link packages/plugins/keychain/package.json ./packages/plugins/keychain/
COPY --link packages/plugins/mcp/package.json ./packages/plugins/mcp/
COPY --link packages/plugins/onepassword/package.json ./packages/plugins/onepassword/
COPY --link packages/plugins/openapi/package.json ./packages/plugins/openapi/
COPY --link packages/react/package.json ./packages/react/
COPY --link apps/cloud/package.json ./apps/cloud/
COPY --link apps/desktop/package.json ./apps/desktop/
RUN bun install --frozen-lockfile

# Build
FROM deps AS build
COPY --link . .
RUN cd apps/cloud && bun run build

# Production
FROM node:22-alpine AS production
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --link --from=build /app/apps/cloud/.output ./apps/cloud/.output
EXPOSE 3000
CMD ["node", "./apps/cloud/.output/server/index.mjs"]
