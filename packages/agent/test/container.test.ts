import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { registerEnvConformance } from "@earendil-works/pi-durable/testing";
import { Connection, RemoteExecutionEnv } from "@earendil-works/pi-env";
import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
import { DockerComputer, sandboxNames } from "../src/computer/docker.ts";
import { Computer } from "../src/computer/index.ts";
import { computerExtension } from "../src/computer.ts";
import { Files } from "../src/files.ts";
import { openAgent } from "../src/open-agent.ts";
import { type DockerConfig, parseConfig } from "../src/runtime/config.ts";
import { png } from "./fixtures/png.ts";

const context = BACKGROUND_CONTEXT;
const enabled = process.env.DOMOS_CONTAINER_TESTS === "1";
const idle = async () => {};

async function setup(network: "none" | "restricted" | "web" = "none") {
  const directory = await mkdtemp(join(tmpdir(), "domos-container-"));
  const input = process.env.DOMOS_TEST_CONFIG
    ? JSON.parse(await readFile(process.env.DOMOS_TEST_CONFIG, "utf8"))
    : {};
  const id = `test-${crypto.randomUUID()}`;
  const config = parseConfig(
    {
      model: { provider: "faux", modelId: "faux-1" },
      ...input,
      dataDir: directory,
      computer: {
        ...input.computer,
        kind: "docker",
        id,
        image: "domos-workspace:1.2.0",
        volume: `${id}-work`,
        network,
        ...(network === "web" ? { proxyImage: "domos-egress:1" } : {}),
      },
    },
    join(directory, "config.json"),
  );
  const computer = new Computer(config);
  const driver = new DockerComputer(config.computer as DockerConfig);
  await computer.bind();
  await computer.manage("start", context, idle);
  return {
    directory,
    computer,
    driver,
    async close() {
      try {
        await computer.close(context);
        await driver.command([
          "docker",
          "container",
          "rm",
          "--force",
          sandboxNames(driver.config).container,
        ]);
        await driver.command(["docker", "volume", "rm", driver.config.volume]);
        if (network === "web")
          await driver.command([
            "docker",
            "rm",
            "-f",
            `${sandboxNames(driver.config).network}-egress`,
          ]);
        if (network !== "none")
          await driver.command([
            "docker",
            "network",
            "rm",
            sandboxNames(driver.config).network,
          ]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

test.runIf(enabled)(
  "HTTP(S) egress blocks private destinations and direct connections",
  async () => {
    const fixture = await setup("web");
    try {
      const env = await fixture.computer.workspace(1, context);
      const publicResult = getOrThrow(
        await env.exec(
          [
            "curl",
            "--fail",
            "--head",
            "--max-time",
            "15",
            "https://example.com",
          ],
          { timeout: 20 },
          context,
        ),
      );
      expect(publicResult.exitCode).toBe(0);
      const denied = [
        "http://127.0.0.1/",
        "http://localhost/",
        "http://169.254.169.254/",
        "http://10.0.0.1/",
        "http://[::ffff:127.0.0.1]/",
      ];
      for (const url of denied) {
        let output = "";
        getOrThrow(
          await env.exec(
            [
              "curl",
              "--silent",
              "--output",
              "/dev/null",
              "--write-out",
              "%{http_code}",
              "--max-time",
              "5",
              url,
            ],
            {
              onOutput: (text) => {
                output += text;
              },
            },
            context,
          ),
        );
        expect(output).toBe("403");
      }
      const direct = getOrThrow(
        await env.exec(
          ["curl", "--noproxy", "*", "--max-time", "3", "http://1.1.1.1/"],
          undefined,
          context,
        ),
      );
      expect(direct.exitCode).not.toBe(0);
    } finally {
      await fixture.close();
    }
  },
);

test.runIf(enabled)(
  "sandbox Agent processes uploaded CSV, publishes results, and restores work after rebuild",
  async () => {
    const fixture = await setup();
    const { computer, directory } = fixture;
    const files = new Files(join(directory, "agent.sqlite"), (id, ctx) =>
      computer.workspace(id, ctx),
    );
    const registry = createRegistry();
    registry.install(files.extension(await createNodePhotonImages()));
    registry.install(computerExtension(computer));
    const faux = fauxProvider({
      models: [
        {
          id: "faux-1",
          input: ["text", "image"],
          inputLimits: {
            images: { resize: { maxWidth: 840, maxHeight: 560 } },
          },
        },
      ],
    });
    const models = createModels();
    models.setProvider(faux.provider);
    const options = {
      models,
      registry,
      env: ({ conversationId }: { conversationId: number }) =>
        files.workspace(conversationId),
    };
    const agent = { model: { provider: "faux", modelId: "faux-1" } };
    const runtime = await openAgent(
      join(directory, "agent.sqlite"),
      options,
      agent,
      context,
      files,
    );
    let closed = false;
    try {
      const id = runtime.conversation.id;
      const input = await files.upload(
        id,
        "数据.csv",
        new TextEncoder().encode("value\n3\n5\n"),
      );
      const image = await files.upload(id, "photo.png", png(2700, 1800));
      const script = `import csv; rows=list(csv.DictReader(open('${input.path}'))); open('report.txt','w').write(str(sum(int(row['value']) for row in rows)))`;
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("read", { path: image.path })], {
          stopReason: "toolUse",
        }),
        async (request) => {
          const result = request.messages.findLast(
            (message) => message.role === "toolResult",
          );
          const part = result?.content.find((part) => part.type === "image");
          if (part?.type !== "image") throw new Error("Image result missing");
          const bytes = Buffer.from(part.data, "base64");
          expect(bytes.readUInt32BE(16)).toBe(840);
          expect(bytes.readUInt32BE(20)).toBe(560);
          return fauxAssistantMessage(
            [
              fauxToolCall("bash", {
                command: `python3 -c '${script.replaceAll("'", "'\\''")}'`,
              }),
            ],
            { stopReason: "toolUse" },
          );
        },
        fauxAssistantMessage(
          [fauxToolCall("attach_file", { path: "report.txt" })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("报告已生成"),
      ]);
      await (
        await runtime.conversation.submit(
          { type: "input", content: `Process ${input.path}` },
          context,
        )
      ).wait(context);
      const published = await files.publish(id, "report.txt", context);
      expect(await (await files.download(id, published.id)).text()).toBe("8");
      expect(await computer.status()).toMatchObject({
        state: "running",
        boundary: "sandbox",
        os: "linux",
      });
      await runtime.harness.close(context);
      closed = true;
      await computer.manage("stop", context, idle);
      expect(await (await files.download(id, published.id)).text()).toBe("8");
      await expect(
        files.upload(id, "stopped.txt", new Uint8Array()),
      ).rejects.toThrow();
      await computer.manage("rebuild", context, idle);
      expect(
        getOrThrow(
          await (await computer.workspace(id, context)).readTextFile(
            "report.txt",
            context,
          ),
        ),
      ).toBe("8");
      const restored = await openAgent(
        join(directory, "agent.sqlite"),
        options,
        agent,
        context,
        files,
      );
      try {
        expect(
          (await restored.conversation.context(context)).messages.length,
        ).toBeGreaterThan(0);
      } finally {
        await restored.harness.close(context);
      }
    } finally {
      if (!closed) await runtime.harness.close(context);
      await fixture.close();
    }
  },
  120_000,
);

test.runIf(enabled)(
  "sandbox permissions isolate service data, other computers and control access",
  async () => {
    const first = await setup();
    const second = await setup();
    try {
      const sentinel = join(first.directory, "service-sentinel.txt");
      await writeFile(sentinel, "controller-only");
      const env = await first.computer.workspace(1, context);
      const shared = await first.computer.workspace(2, context);
      const isolated = await second.computer.workspace(1, context);
      getOrThrow(
        await env.writeFile("/home/domos/shared.txt", "shared", context),
      );
      expect(
        getOrThrow(
          await shared.readTextFile("/home/domos/shared.txt", context),
        ),
      ).toBe("shared");
      expect(
        await isolated.exists("/home/domos/shared.txt", context),
      ).toMatchObject({ ok: true, value: false });
      const script =
        "import os,socket,sys; assert os.getuid()!=0; assert not os.path.exists('/var/run/docker.sock'); assert not os.path.exists('/data/agent.sqlite'); assert not os.path.exists(sys.argv[1]); assert [name for _,name in socket.if_nameindex()]==['lo']; assert any(line.split()==['NoNewPrivs:','1'] for line in open('/proc/self/status'))";
      expect(
        getOrThrow(
          await env.exec(
            ["python3", "-c", script, sentinel],
            undefined,
            context,
          ),
        ).exitCode,
      ).toBe(0);
      const capped = await env.exec(["sleep", "5"], { timeout: 0.1 }, context);
      expect(capped).toMatchObject({ ok: false, error: { code: "timeout" } });
      const controller = new AbortController();
      const ready = Promise.withResolvers<void>();
      const pending = env.exec(
        "echo ready; sleep 20",
        { onOutput: () => ready.resolve() },
        withAbortSignal(controller.signal, context),
      );
      await ready.promise;
      controller.abort();
      expect(await pending).toMatchObject({
        ok: false,
        error: { code: "aborted" },
      });
      expect(
        getOrThrow(await shared.exec("printf live", undefined, context))
          .exitCode,
      ).toBe(0);
      const output = getOrThrow(
        await env.exec(
          ["python3", "-c", "print('x' * 1000)"],
          { spill: { afterBytes: 64, afterLines: 1 } },
          context,
        ),
      );
      if (!output.spillPath) throw new Error("Command output file missing");
      expect(
        getOrThrow(await env.readTextFile(output.spillPath, context)).length,
      ).toBeGreaterThan(1000);
    } finally {
      await first.close();
      await second.close();
    }
  },
  120_000,
);

test.runIf(enabled)(
  "restricted egress permits public internet and refuses metadata and Docker host access",
  async () => {
    const fixture = await setup("restricted");
    try {
      const env = await fixture.computer.workspace(1, context);
      expect(
        getOrThrow(
          await env.exec(
            ["curl", "--fail", "--max-time", "15", "https://example.com"],
            undefined,
            context,
          ),
        ).exitCode,
      ).toBe(0);
      const script =
        "import socket; s=socket.socket(); s.settimeout(1); assert s.connect_ex(('169.254.169.254',80))!=0; gateway=socket.inet_ntoa(bytes.fromhex(open('/proc/net/route').readlines()[1].split()[2])[::-1]); assert s.connect_ex((gateway,22))!=0";
      expect(
        getOrThrow(
          await env.exec(["python3", "-c", script], undefined, context),
        ).exitCode,
      ).toBe(0);
    } finally {
      await fixture.close();
    }
  },
  120_000,
);

describe.skipIf(!enabled)(
  "Pi environment conformance inside the work sandbox",
  () => {
    let fixture: Awaited<ReturnType<typeof setup>>;
    beforeAll(async () => {
      fixture = await setup();
    }, 120_000);
    afterAll(async () => {
      if (fixture) await fixture.close();
    });
    registerEnvConformance(
      { describe, expect, it },
      "Docker transport",
      async (use) => {
        const connection = new Connection({ command: fixture.driver.daemon() });
        const env = new RemoteExecutionEnv({
          connection,
          id: fixture.driver.config.id,
          cwd: `/home/domos/conformance/${crypto.randomUUID()}`,
        });
        try {
          getOrThrow(
            await env.createDir(env.cwd, { recursive: true }, context),
          );
          await use(env);
        } finally {
          await env.cleanup(context);
          connection.close();
        }
      },
      { listFiles: true },
    );
  },
);
