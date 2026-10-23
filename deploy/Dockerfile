ARG NODE_IMAGE=node:24-bookworm-slim
ARG DOCKER_CLI_IMAGE=docker:29-cli
FROM ${DOCKER_CLI_IMAGE} AS docker
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN npm install --global pnpm@10.20.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY deploy/NOTICE ./deploy/NOTICE
COPY deploy/licenses ./deploy/licenses
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build

FROM ${NODE_IMAGE}
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client ca-certificates && rm -rf /var/lib/apt/lists/* && npm install --global pnpm@10.20.0
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml domos.config.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/cli/package.json ./apps/cli/package.json
COPY apps/controller/package.json ./apps/controller/package.json
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/agent/package.json ./packages/agent/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/hosting/package.json ./packages/hosting/package.json
RUN pnpm install --prod --frozen-lockfile && mkdir /data && chown node:node /data
COPY apps/api/src ./apps/api/src
COPY apps/cli/src ./apps/cli/src
COPY apps/controller/src ./apps/controller/src
COPY packages/agent/src ./packages/agent/src
COPY packages/ui/src ./packages/ui/src
COPY packages/hosting/src ./packages/hosting/src
COPY deploy/release.json ./deploy/release.json
COPY deploy/NOTICE /usr/share/doc/domos/NOTICE
COPY deploy/licenses/ /usr/share/doc/domos/licenses/
COPY --from=build /app/apps/web/dist ./apps/web/dist
ENV NODE_ENV=production DOMOS_HOST=0.0.0.0 DOMOS_DATA_DIR=/data DOMOS_DEPLOYMENT=container DOMOS_PUBLIC_URL=http://localhost:4310
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:4310/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/api/src/main.ts"]
