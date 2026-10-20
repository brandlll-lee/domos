import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import { openComputerService } from "./computer-service.mjs";
import { openGateway } from "./gateway.mjs";
import { openHttpService } from "./http-service.mjs";
import { seedPiAccount } from "./pi-account.mjs";

delete process.env.ELECTRON_RUN_AS_NODE;

let child;
let gateway;
let closing;
let configured = false;
let sequence = 0;
let home;
let http;
const pending = new Map();
const operations = new Map();
let computer;
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

async function close() {
  closing ??= (async () => {
    gateway?.close();
    http?.close();
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
  home = frame.home;
  process.env.CLAUDE_CONFIG_DIR = join(home, "claude");
  process.chdir(frame.cwd);
  computer = openComputerService(frame.cwd, frame.home);
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
    cwd: frame.cwd,
    home: frame.home,
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
  const inherited = [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "DISPLAY",
    "XAUTHORITY",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
    "AT_SPI_BUS_ADDRESS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
    "NO_PROXY",
    "no_proxy",
  ];
  const env = Object.fromEntries(
    inherited
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  Object.assign(env, { HOME: home, USERPROFILE: home }, frame.env);
  if (frame.http) {
    http = await openHttpService(emit, frame.http);
    env.OPENCODE_SERVER_PASSWORD = http.password;
    frame.args = frame.args.map((arg) =>
      arg === "__DOMOS_PORT__" ? String(http.port) : arg,
    );
  }
  for (const directory of [
    env.CODEX_HOME,
    env.CLAUDE_CONFIG_DIR,
    env.XDG_DATA_HOME,
    env.XDG_CONFIG_HOME,
  ]) {
    if (directory) await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  env.NODE_USE_ENV_PROXY = "1";
  env.NO_PROXY = [env.NO_PROXY, "127.0.0.1", "localhost"]
    .filter(Boolean)
    .join(",");
  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] =
    `${join(home, "runtime", "node_modules", ".bin")}${delimiter}${env[pathKey] ?? ""}`;
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
  const piAuth = env.DOMOS_PI_AUTH;
  delete env.DOMOS_PI_AUTH;
  if (piAuth) {
    const directory = env.PI_CODING_AGENT_DIR;
    if (!directory) throw new Error("Pi account directory required");
    await seedPiAccount(directory, JSON.parse(piAuth));
  }
  if (env.DOMOS_PI_MCP_URL) {
    const path = join(process.cwd(), ".domos-pi.mjs");
    await writeFile(
      path,
      `export default function(pi) {
  pi.registerMcpServer("domos", { url: process.env.DOMOS_PI_MCP_URL, exposure: "direct" });
  if (process.platform === "win32") pi.on("session_start", () => {
    pi.setActiveTools([...pi.getActiveTools().filter(name => name !== "bash"), "powershell"]);
  });
  pi.on("message_end", ({ message }) => {
    if (message.role !== "toolResult" || !message.isError) return;
    const tools = pi.getActiveTools();
    if (tools.includes(message.toolName)) return;
    return { message: { ...message, content: [{
      type: "text",
      text: "The requested tool is not active. Nothing was executed. Currently active tools: " + tools.join(", ") + ". Select an active tool by its exact name."
    }] } };
  });
}\n`,
      { mode: 0o600 },
    );
    frame.args.push("--extension", path);
  }
  const bundledPi = frame.command === "pi";
  if (bundledPi) env.ELECTRON_RUN_AS_NODE = "1";
  child = spawn(
    bundledPi ? process.execPath : frame.command,
    bundledPi
      ? [
          fileURLToPath(new URL("./pi-entry.mjs", import.meta.url)),
          ...frame.args,
        ]
      : frame.args,
    {
      cwd: process.cwd(),
      env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stdin.on("error", () => {});
  child.stdout.setEncoding("utf8").on("data", (data) => {
    http?.capture(data);
    emit({ type: "stdout", data });
  });
  child.stderr.setEncoding("utf8").on("data", (data) => {
    http?.capture(data);
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
    http?.close();
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
      else if (frame.type === "http") {
        if (!http) throw new Error("Service unavailable");
        void http.request(frame);
      } else if (frame.type === "history") {
        void import("@anthropic-ai/claude-agent-sdk")
          .then(({ getSessionMessages }) =>
            getSessionMessages(frame.sessionId, { dir: process.cwd() }),
          )
          .then((result) => emit({ type: "http", id: frame.id, result }))
          .catch(() =>
            emit({
              type: "http",
              id: frame.id,
              error: "原生会话记录无法读取。请检查工作电脑和会话文件。",
            }),
          );
      } else if (frame.type === "computer") {
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
