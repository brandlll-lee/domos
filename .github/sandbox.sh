#!/usr/bin/env bash
set -euo pipefail
docker build -f deploy/Dockerfile -t domos-app:test .
docker volume create domos-app-test
for cycle in 1 2; do
  docker run -d --name domos-app-test --read-only --cap-drop=ALL --security-opt=no-new-privileges:true --tmpfs /tmp -v domos-app-test:/data -p 127.0.0.1:4310:4310 -e DOMOS_PUBLIC_URL=http://127.0.0.1:4310 domos-app:test
  for attempt in $(seq 1 45); do
    if curl --fail --silent http://127.0.0.1:4310/health >/dev/null; then break; fi
    sleep 1
  done
  curl --fail --silent http://127.0.0.1:4310/health
  curl --fail --silent http://127.0.0.1:4310/ >/dev/null
  docker exec domos-app-test node --input-type=module -e 'import { Computer } from "./packages/agent/src/computer/index.ts"; import { loadConfig } from "./packages/agent/src/runtime/config.ts"; const state=await new Computer(await loadConfig()).status(); if(state.boundary!=="application"||state.os.split(" ")[0]!=="linux")process.exit(1);'
  if [ "$cycle" = 1 ]; then
    docker exec domos-app-test node -e 'require("fs").writeFileSync("/data/deployment-check", "durable")'
  else
    docker exec domos-app-test node -e 'if(require("fs").readFileSync("/data/deployment-check","utf8")!=="durable")process.exit(1)'
  fi
  docker stop --time 20 domos-app-test
  docker rm domos-app-test
done
docker volume rm domos-app-test

case "${1:?Transport required}" in
  docker)
    pnpm exec vitest run apps/api/test/stack-container.test.ts
    ;;
  ssh)
    mkdir "$RUNNER_TEMP/domos-app-ssh"
    sudo install -m 0600 -o 1000 -g 1000 "$RUNNER_TEMP/domos-key" "$RUNNER_TEMP/domos-app-ssh/id_ed25519"
    cp "$RUNNER_TEMP/domos-known-hosts" "$RUNNER_TEMP/domos-app-ssh/known_hosts"
    node --input-type=module <<'JS'
    import { writeFileSync } from 'node:fs';
    import { userInfo } from 'node:os';
    writeFileSync(`${process.env.RUNNER_TEMP}/domos-app.json`, JSON.stringify({
      model: { provider: 'deepseek', modelId: 'deepseek-flash' },
      computer: { kind: 'docker', id: 'ci-app', image: 'domos-workspace:1.2.0', volume: 'domos-ci-app-work', ssh: {
        host: 'host.docker.internal', user: userInfo().username, identityFile: '/home/node/.ssh/id_ed25519',
        knownHostsFile: '/home/node/.ssh/known_hosts', hostKeyAlias: 'domos-ci'
      } }
    }));
JS
    docker run -d --name domos-app-ssh --read-only --cap-drop=ALL --security-opt=no-new-privileges:true --tmpfs /tmp --add-host host.docker.internal:host-gateway -v domos-app-ssh-data:/data -v "$RUNNER_TEMP/domos-app-ssh:/home/node/.ssh:ro" -v "$RUNNER_TEMP/domos-app.json:/app/config.json:ro" -e DOMOS_CONFIG=/app/config.json domos-app:test
    docker exec -i -w /app/packages/agent domos-app-ssh node --input-type=module <<'JS'
    import assert from 'node:assert/strict';
    import { join } from 'node:path';
    import { Computer } from './src/computer/index.ts';
    import { loadConfig } from './src/runtime/config.ts';
    import { Files } from './src/files.ts';
    import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
    import { getOrThrow } from '@earendil-works/pi-durable/env';
    const config = await loadConfig();
    const computer = new Computer(config);
    try {
      await computer.manage('start', context, async () => {});
      const files = new Files(join(config.dataDir, 'agent.sqlite'), (id, ctx) => computer.workspace(id, ctx));
      const uploaded = await files.upload(1, 'data.csv', new TextEncoder().encode('value\n3\n5\n'));
      const env = await computer.workspace(1, context);
      const script = "import csv,sys; open('report.txt','w').write(str(sum(int(row['value']) for row in csv.DictReader(open(sys.argv[1])))))";
      assert.equal(getOrThrow(await env.exec(['python3','-c',script,uploaded.path], undefined, context)).exitCode, 0);
      const artifact = await files.publish(1, 'report.txt', context);
      assert.equal(await (await files.download(1, artifact.id)).text(), '8');
      assert.equal((await computer.status()).boundary, 'sandbox');
      await computer.manage('stop', context, async () => {});
      assert.equal(await (await files.download(1, artifact.id)).text(), '8');
    } finally { await computer.close(context); }
JS
    docker stop --time 20 domos-app-ssh
    docker rm domos-app-ssh
    docker rm domos-ci-app
    docker volume rm domos-ci-app-work
    docker volume rm domos-app-ssh-data
    ;;
  *) echo "Unknown sandbox transport: $1" >&2; exit 2 ;;
esac
