ARG NODE_IMAGE=node:24-bookworm-slim
ARG WORK_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS daemon
ARG TARGETARCH
WORKDIR /build
RUN npm pack @earendil-works/pi-env@1.2.0 && tar -xzf earendil-works-pi-env-1.2.0.tgz && node -e "const fs=require('fs');const arch={amd64:'x64',arm64:'arm64'}[process.env.TARGETARCH];if(!arch)throw Error('Unsupported work image architecture');fs.copyFileSync('package/bin/pi-env-linux-'+arch+'/pi-env','/build/pi-env')"
RUN npm install --prefix /opt/domos --omit=dev --no-audit --no-fund @earendil-works/pi-coding-agent@1.2.0 @modelcontextprotocol/sdk@1.32.1 cross-spawn@7.0.6 proper-lockfile@4.1.2

FROM ${WORK_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates coreutils curl git python3 && rm -rf /var/lib/apt/lists/* && groupmod --new-name domos node && usermod --login domos --home /home/domos --move-home node
COPY --from=daemon --chmod=0755 /build/pi-env /usr/local/bin/pi-env
COPY --from=daemon /opt/domos /opt/domos
COPY packages/agent/src/harness/worker.mjs packages/agent/src/harness/gateway.mjs packages/agent/src/harness/pi-account.mjs packages/agent/src/harness/http-service.mjs /opt/domos/
COPY deploy/licenses/pi.txt /usr/share/doc/pi/LICENSE
COPY deploy/licenses/mcp-sdk.txt deploy/licenses/cross-spawn.txt deploy/licenses/proper-lockfile.txt /usr/share/doc/domos/licenses/
ENV HOME=/home/domos
USER 1000:1000
WORKDIR /home/domos
CMD ["sleep", "infinity"]
