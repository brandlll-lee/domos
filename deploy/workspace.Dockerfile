ARG NODE_IMAGE=node:24-bookworm-slim
ARG WORK_IMAGE=debian:bookworm-slim
FROM ${NODE_IMAGE} AS daemon
ARG TARGETARCH
WORKDIR /build
RUN npm pack @earendil-works/pi-env@1.2.0 && tar -xzf earendil-works-pi-env-1.2.0.tgz && node -e "const fs=require('fs');const arch={amd64:'x64',arm64:'arm64'}[process.env.TARGETARCH];if(!arch)throw Error('Unsupported work image architecture');fs.copyFileSync('package/bin/pi-env-linux-'+arch+'/pi-env','/build/pi-env')"

FROM ${WORK_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates coreutils curl git python3 && rm -rf /var/lib/apt/lists/* && groupadd --gid 1000 domos && useradd --uid 1000 --gid 1000 --create-home domos
COPY --from=daemon --chmod=0755 /build/pi-env /usr/local/bin/pi-env
COPY deploy/licenses/pi.txt /usr/share/doc/pi/LICENSE
ENV HOME=/home/domos
USER 1000:1000
WORKDIR /home/domos
CMD ["sleep", "infinity"]
