import { once } from "node:events";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import spawn from "cross-spawn";
import { openComputerService } from "./computer-service.mjs";
import { openGateway } from "./gateway.mjs";
import { processEnvironment } from "./process-environment.mjs";

delete process.env.ELECTRON_RUN_AS_NODE;
const accountEnv = { ...process.env };

let child;
let gateway;
let closing;
let configured = false;
let sequence = 0;
let home;
const pending = new Map();
const operations = new Map();
let computer;
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

async function close() {
  closing ??= (async () => {
    gateway?.close();
    for (const item of pending.values())
      item.reject(new Error("Connection closed"));
    pending.clear();
    for (const operation of operations.values()) operation.abort();
    await computer?.close();
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
      return;
    const exited = once(child, "close").catch(() => {});
    if (process.platform === "win32") {
      await new Promise((resolve) => {
        const stop = spawn(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        stop.once("error", resolve);
        stop.once("close", resolve);
      });
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
    const force = setTimeout(() => {
      if (process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
    }, 5000);
    force.unref();
    await exited;
    clearTimeout(force);
  })();
  return closing;
}

async function configure(frame) {
  if (configured) throw new Error("Worker already configured");
  configured = true;
  if (typeof frame.cwd !== "string" || typeof frame.home !== "string")
    throw new Error("Workspace required");
  await mkdir(frame.cwd, { recursive: true, mode: 0o700 });
  await mkdir(frame.home, { recursive: true, mode: 0o700 });
  home = await realpath(frame.home);
  process.chdir(await realpath(frame.cwd));
  computer = openComputerService(process.cwd(), home, (value) =>
    emit({ type: "activity", value }),
  );
  gateway = await openGateway(
    frame.tools,
    (callId, name, args, signal) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        const abort = () => emit({ type: "cancel", id });
        signal.addEventListener("abort", abort, { once: true });
        pending.set(id, {
          resolve: (result) => {
            signal.removeEventListener("abort", abort);
            resolve(result);
          },
          reject,
        });
        emit({ type: "tool", id, callId, name, args });
      }),
  );
  emit({
    type: "ready",
    url: gateway.url,
    cwd: process.cwd(),
    home,
  });
}

async function launch(frame) {
  if (
    !configured ||
    child ||
    typeof frame.command !== "string" ||
    !Array.isArray(frame.args)
  )
    throw new Error("Invalid launch");
  const env = processEnvironment(frame, home, accountEnv);
  env.NODE_USE_ENV_PROXY = "1";
  env.NO_PROXY = [env.NO_PROXY, "127.0.0.1", "localhost"]
    .filter(Boolean)
    .join(",");
  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const runtimePath = join(home, "runtime", "node_modules", ".bin");
  env[pathKey] = `${runtimePath}${delimiter}${env[pathKey] ?? ""}`;
  if (frame.instructions) {
    const path = join(process.cwd(), ".domos-instructions.md");
    await writeFile(path, frame.instructions, { mode: 0o600 });
    frame.args = frame.args.map((arg) =>
      arg === "__DOMOS_PROMPT__" ? path : arg,
    );
  }
  if (frame.mcp) {
    const path = join(process.cwd(), ".domos-mcp.json");
    await writeFile(
      path,
      JSON.stringify({
        mcpServers: { domos: { type: "http", url: frame.mcp.url } },
      }),
      { mode: 0o600 },
    );
    frame.args = frame.args.map((arg) =>
      arg === "__DOMOS_MCP__" ? path : arg,
    );
  }
  child = spawn(frame.command, frame.args, {
    cwd: process.cwd(),
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});
  child.stdout.setEncoding("utf8").on("data", (data) => {
    emit({ type: "stdout", data });
  });
  child.stderr.setEncoding("utf8").on("data", (data) => {
    emit({ type: "stderr", data });
  });
  child.once("spawn", () => emit({ type: "spawn" }));
  child.once("error", (error) =>
    emit({
      type: "failure",
      code: error.code,
      message: "所选电脑未能启动引擎。请检查安装和权限。",
    }),
  );
  child.once("close", (code) => {
    emit({ type: "exit", code });
    gateway?.close();
  });
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let changing = Promise.resolve();
lines.on("line", (line) => {
  changing = changing
    .then(async () => {
      if (Buffer.byteLength(line) > 16 * 1024 * 1024)
        throw new Error("Frame too large");
      const frame = JSON.parse(line);
      if (frame.type === "configure") await configure(frame);
      else if (frame.type === "launch") await launch(frame);
      else if (frame.type === "input") child?.stdin.write(frame.data);
      else if (frame.type === "computer") {
        const controller = new AbortController();
        operations.set(frame.id, controller);
        void computer
          .request(frame.input, controller.signal)
          .then((result) => emit({ type: "http", id: frame.id, result }))
          .catch((error) =>
            emit({ type: "http", id: frame.id, error: error.message }),
          )
          .finally(() => operations.delete(frame.id));
      } else if (frame.type === "computer_cancel") {
        operations.get(frame.id)?.abort();
      } else if (frame.type === "result") {
        const call = pending.get(frame.id);
        pending.delete(frame.id);
        call?.resolve(frame.result);
      } else if (frame.type === "close") {
        await close();
        lines.close();
        process.stdin.destroy();
      }
    })
    .catch(async () => {
      emit({ type: "failure", message: "引擎连接未完成。请检查工作电脑。" });
      await close();
      lines.close();
      process.stdin.destroy();
    });
});
lines.once("close", () => {
  void changing.then(close);
});
process.once("SIGTERM", () => {
  void close().then(() => process.exit());
});
