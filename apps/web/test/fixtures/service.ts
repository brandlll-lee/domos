import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";

class TestService {
  worker!: ChildProcess;
  url = "";
  toolName = "";
  pairing = "";
  readonly database: string;
  private proxy?: Server;

  constructor(readonly directory: string) {
    this.database = join(directory, "agent.sqlite");
  }

  async start(port = 0, mode: boolean | "hosting" | "https" = false) {
    let publicUrl: string | undefined;
    const certificate = fileURLToPath(
      new URL("../../../api/test/fixtures/localhost-cert.pem", import.meta.url),
    );
    if (mode === "https") {
      this.proxy = createServer(
        {
          cert: await readFile(certificate),
          key: await readFile(
            new URL(
              "../../../api/test/fixtures/localhost-key.pem",
              import.meta.url,
            ),
          ),
        },
        (incoming, outgoing) => {
          const forwarded = request(
            new URL(incoming.url ?? "/", `http://127.0.0.1:${port}`),
            { method: incoming.method, headers: incoming.headers },
            (response) => {
              outgoing.writeHead(response.statusCode ?? 502, response.headers);
              response.pipe(outgoing);
            },
          );
          forwarded.on("error", () => {
            outgoing.writeHead(502);
            outgoing.end();
          });
          incoming.pipe(forwarded);
          outgoing.on("close", () => forwarded.destroy());
        },
      );
      this.proxy.listen(0, "127.0.0.1");
      await once(this.proxy, "listening");
      const address = this.proxy.address();
      if (!address || typeof address === "string")
        throw new Error("HTTPS port required");
      publicUrl = `https://127.0.0.1:${address.port}`;
    }
    this.worker = fork(
      fileURLToPath(
        new URL("../../../api/test/fixtures/web-server.ts", import.meta.url),
      ),
      [
        this.database,
        String(port),
        mode === "hosting" || mode === "https"
          ? "hosting"
          : mode
            ? "native"
            : "",
        publicUrl ?? "",
      ],
      {
        silent: true,
        execArgv: [],
        ...(publicUrl
          ? { env: { ...process.env, NODE_EXTRA_CA_CERTS: certificate } }
          : {}),
      },
    );
    this.worker.stderr?.resume();
    this.worker.stdout?.resume();
    const ready = await Promise.race([
      once(this.worker, "message").then(
        ([message]) =>
          message as {
            port: number;
            toolName: string;
            pairing?: string;
          },
      ),
      once(this.worker, "exit").then(() => {
        throw new Error("Test server exited");
      }),
    ]);
    port = ready.port;
    this.url = publicUrl ?? `http://127.0.0.1:${ready.port}`;
    this.toolName = ready.toolName;
    this.pairing = ready.pairing ?? "";
  }

  async stop() {
    if (this.proxy) {
      this.proxy.closeAllConnections();
      this.proxy.close();
      this.proxy = undefined;
    }
    if (this.worker.exitCode !== null || this.worker.signalCode !== null)
      return;
    const exited = once(this.worker, "exit");
    this.worker.kill("SIGKILL");
    await exited;
  }

  async control(command: Parameters<ChildProcess["send"]>[0]) {
    const receipt = once(this.worker, "message");
    this.worker.send(command);
    await receipt;
  }

  async close() {
    if (this.proxy) {
      this.proxy.closeAllConnections();
      this.proxy.close();
      this.proxy = undefined;
    }
    if (
      this.worker &&
      this.worker.exitCode === null &&
      this.worker.signalCode === null
    ) {
      const exited = once(this.worker, "exit");
      if (this.worker.connected) this.worker.disconnect();
      else this.worker.kill("SIGKILL");
      await exited;
    }
    await rm(this.directory, { recursive: true, force: true, maxRetries: 5 });
  }
}

export const test = base.extend<{ service: TestService }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from this pattern.
  service: async ({}, use) => {
    const service = new TestService(
      await mkdtemp(join(tmpdir(), "domos-browser-")),
    );
    try {
      await service.start();
      await use(service);
    } finally {
      await service.close();
    }
  },
});
