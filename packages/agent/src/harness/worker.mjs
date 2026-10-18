import { once } from "node:events";
import { access, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import { openGateway } from "./gateway.mjs";
import { seedPiAccount } from "./pi-account.mjs";

let child;
let gateway;
let closing;
let configured = false;
let sequence = 0;
let home;
const pending = new Map();
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

async function close() {
  closing ??= (async () => {
    gateway?.close();
    for (const item of pending.values())
      item.reject(new Error("Connection closed"));
    pending.clear();
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
  process.chdir(frame.cwd);
  gateway = await openGateway(
    frame.tools,
    (callId, name, args) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        emit({ type: "tool", id, callId, name, args });
      }),
  );
  const exists = (path) =>
    access(path).then(
      () => true,
      () => false,
    );
  emit({
    type: "ready",
    url: gateway.url,
    cwd: frame.cwd,
    home: frame.home,
    accounts: {
      claude: await exists(join(home, "claude", ".credentials.json")),
      opencode: await exists(
        join(home, "opencode", "data", "opencode", "auth.json"),
      ),
    },
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
      'export default function(pi) { pi.registerMcpServer("domos", { url: process.env.DOMOS_PI_MCP_URL, exposure: "direct" }); }\n',
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
          fileURLToPath(
            import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"),
          ),
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
  child.stdout
    .setEncoding("utf8")
    .on("data", (data) => emit({ type: "stdout", data }));
  child.stderr
    .setEncoding("utf8")
    .on("data", (data) => emit({ type: "stderr", data }));
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
      else if (frame.type === "result") {
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
