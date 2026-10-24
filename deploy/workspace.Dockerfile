ARG NODE_IMAGE=node:24-bookworm-slim
ARG WORK_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS daemon
ARG TARGETARCH
WORKDIR /build
RUN npm pack @earendil-works/pi-env@1.2.0 && tar -xzf earendil-works-pi-env-1.2.0.tgz && node -e "const fs=require('fs');const arch={amd64:'x64',arm64:'arm64'}[process.env.TARGETARCH];if(!arch)throw Error('Unsupported work image architecture');fs.copyFileSync('package/bin/pi-env-linux-'+arch+'/pi-env','/build/pi-env')"
RUN npm install --prefix /opt/domos --omit=dev --no-audit --no-fund @earendil-works/pi-coding-agent@1.2.0 @modelcontextprotocol/sdk@1.32.1 cross-spawn@7.0.6 proper-lockfile@4.1.2 agent-browser@0.39.1 @trycua/cua-driver@0.36.0 @anthropic-ai/claude-agent-sdk@0.3.303 electron@44.8.0 && node -e "require('/opt/domos/node_modules/electron')" && rm -rf /opt/domos/node_modules/@anthropic-ai/claude-agent-sdk-*

FROM ${WORK_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates coreutils curl git python3 xvfb x11-utils dbus dbus-x11 openbox pcmanfm xterm chromium at-spi2-core libxi6 libxtst6 libxrandr2 libgtk-3-0 libnss3 libgbm1 libasound2 fonts-noto-cjk fonts-noto-color-emoji && rm -rf /var/lib/apt/lists/* && groupmod --new-name domos node && usermod --login domos --home /home/domos --move-home node
COPY --from=daemon --chmod=0755 /build/pi-env /usr/local/bin/pi-env
COPY --from=daemon /opt/domos /opt/domos
COPY packages/agent/src/harness/worker.mjs packages/agent/src/harness/account-environment.mjs packages/agent/src/harness/gateway.mjs packages/agent/src/harness/pi-entry.mjs packages/agent/src/harness/pi-account.mjs packages/agent/src/harness/http-service.mjs packages/agent/src/harness/browser-service.mjs packages/agent/src/harness/computer-service.mjs /opt/domos/
COPY deploy/licenses/pi.txt /usr/share/doc/pi/LICENSE
COPY packages/agent/src/harness/browser-view.mjs packages/agent/src/harness/desktop-view.mjs /opt/domos/
COPY packages/agent/src/harness/desktop-activity.mjs packages/agent/src/harness/desktop-actions.mjs packages/agent/src/harness/desktop-motion.mjs packages/agent/src/harness/desktop-target.mjs packages/agent/src/harness/desktop-overlay.mjs packages/agent/src/harness/desktop-overlay-preload.cjs /opt/domos/
COPY packages/ui/package.json /opt/domos/node_modules/@domos/ui/package.json
COPY packages/ui/src/computer-effect.mjs /opt/domos/node_modules/@domos/ui/src/computer-effect.mjs
COPY deploy/workspace.mjs /opt/domos/workspace.mjs
COPY deploy/licenses/mcp-sdk.txt deploy/licenses/cross-spawn.txt deploy/licenses/proper-lockfile.txt /usr/share/doc/domos/licenses/
COPY deploy/licenses/agent-browser.txt deploy/licenses/cua-driver.txt deploy/licenses/claude-agent-sdk.txt /usr/share/doc/domos/licenses/
ENV HOME=/home/domos DISPLAY=:99 XDG_RUNTIME_DIR=/tmp/domos-runtime DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/domos-desktop-bus AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium AGENT_BROWSER_HEADED=1 AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage
USER 1000:1000
WORKDIR /home/domos
CMD ["node", "/opt/domos/workspace.mjs"]
