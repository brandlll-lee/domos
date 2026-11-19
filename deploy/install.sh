#!/bin/sh
set -eu
manifest=$(realpath "${1:?请指定正式发布清单}")
cd "$(dirname "$0")/.."
docker info --format '{{.OSType}}' | grep -qx linux
docker compose -f deploy/compose.yaml build
docker compose -f deploy/compose.yaml run --rm --no-deps -v "$manifest:/release.json:ro" controller node apps/controller/src/install.ts /control /release.json
docker compose -f deploy/compose.yaml up -d
printf '%s\n' 'Domos: http://localhost:4310' '首次管理员码：docker compose -f deploy/compose.yaml exec app cat /data/owner-code'
