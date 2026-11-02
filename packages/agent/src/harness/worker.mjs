import { once } from "node:events";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import spawn from "cross-spawn";
import {
  accountEnvironment,
  accountFingerprint,
  resolveProgram,
} from "./account-environment.mjs";
import { openComputerService } from "./computer-service.mjs";
import { openGateway } from "./gateway.mjs";
import { openHttpService } from "./http-service.mjs";
import { closeMcpClients, mcpOperation } from "./mcp-client.mjs";
import { nativeCheckpoint, nativeHistory } from "./native-history.mjs";
import { nativeMcp } from "./native-mcp.mjs";

delete process.env.ELECTRON_RUN_AS_NODE;
const accountEnv = { ...process.env };

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
let tools;
const gateways = new Map();
const mcpProgress = new Map();
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

async function close(force = false) {
  if (force && child?.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  closing ??= (async () => {
    gateway?.close();
    http?.close();
    for (const item of pending.values())
      item.reject(new Error("Connection closed"));
    pending.clear();
    for (const operation of operations.values()) operation.abort();
    const mcpClosed = Promise.all([
      ...[...gateways.values()].map((gateway) => gateway.close()),
      closeMcpClients(),
    ]);
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
      await mcpClosed;
      return computer?.close();
    }
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
        process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
      } catch {}
    }
    const forceTimer = setTimeout(() => {
      if (process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
    }, 5000);
    forceTimer.unref();
    await exited;
    clearTimeout(forceTimer);
    await mcpClosed;
    await computer?.close();
  })();
  return closing;
}

async function configure(frame) {
  if (configured) throw new Error("Worker already configured");
  configured = true;
  tools = frame.tools;
  if (typeof frame.cwd !== "string" || typeof frame.home !== "string")
    throw new Error("Workspace required");
  await mkdir(frame.cwd, { recursive: true, mode: 0o700 });
  await mkdir(frame.home, { recursive: true, mode: 0o700 });
  home = await realpath(frame.home);
  process.chdir(await realpath(frame.cwd));
  computer = openComputerService(process.cwd(), home);
  gateway = await openGateway(frame.tools, invoke);
  emit({
    type: "ready",
    url: gateway.url,
    cwd: process.cwd(),
    home,
    tools: tools.map((tool) => tool.name),
  });
}

function invoke(callId, name, args, signal) {
  return new Promise((resolve, reject) => {
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
  });
}

async function manageMcp(input, signal, onprogress) {
  if (input.action === "progress") {
    await mcpProgress.get(input.requestId)?.(input.progress);
    return {};
  }
  if (input.action === "notify") {
    await gateways.get(input.id)?.notify(input.notification);
    return {};
  }
  if (input.action === "native")
    return nativeMcp(input.config, home, accountEnv, process.cwd());
  if (input.action === "mount") {
    if (gateways.has(input.id)) throw new Error("MCP 已挂载。");
    const request = async (callId, method, params, signal, progress) => {
      const requestId = `mcp:${input.id}:${callId}`;
      if (progress) mcpProgress.set(requestId, progress);
      try {
        return await invoke(
          requestId,
          "mcp_call",
          { id: input.id, method, params, requestId },
          signal,
        );
      } finally {
        mcpProgress.delete(requestId);
      }
    };
    const gateway = await openGateway(
      input.tools,
      (callId, name, args, signal, _meta, progress) =>
        request(
          callId,
          "tools/call",
          { name, arguments: args, _meta },
          signal,
          progress,
        ),
      { name: input.name, capabilities: input.capabilities, request },
    );
    gateways.set(input.id, gateway);
    return { url: gateway.url };
  }
  return mcpOperation(input, signal, onprogress, async (notification) => {
    const gateway = gateways.get(input.id);
    if (gateway) await gateway.notify(notification);
    else emit({ type: "mcp_notification", id: input.id, notification });
  });
}

async function launch(frame) {
  if (closing) throw new Error("Session closed");
  if (
    !configured ||
    child ||
    typeof frame.command !== "string" ||
    !Array.isArray(frame.args)
  )
    throw new Error("Invalid launch");
  const account = await accountEnvironment(frame, home, accountEnv);
  const env = account.env;
  frame.command = await resolveProgram(frame.command, env);
  if (!frame.command)
    throw Object.assign(new Error("工作电脑未安装所选程序。"), {
      code: "ENOENT",
    });
  process.env.CLAUDE_CONFIG_DIR =
    env.CLAUDE_CONFIG_DIR || join(env.HOME, ".claude");
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
        mcpServers: {
          domos: { type: "http", url: frame.mcp.url },
          ...Object.fromEntries(
            (frame.mcp.servers ?? []).map(({ name, url }) => [
              name,
              { type: "http", url },
            ]),
          ),
        },
      }),
      { mode: 0o600 },
    );
    frame.args = frame.args.map((arg) =>
      arg === "__DOMOS_MCP__" ? path : arg,
    );
  }
  if (env.DOMOS_PI_MCP_URL) {
    const path = join(process.cwd(), ".domos-tools.json");
    await writeFile(
      path,
      JSON.stringify({
        url: gateway.url,
        tools,
        servers: frame.mcp?.servers ?? [],
      }),
      {
        mode: 0o600,
      },
    );
    env.DOMOS_PI_TOOLS = path;
    frame.args.push(
      "--no-extensions",
      "--extension",
      "builtin:tool-search",
      "--extension",
      fileURLToPath(new URL("./pi-tools.mjs", import.meta.url)),
      "--extension",
      "builtin:mcp",
    );
  }
  if (env.DOMOS_PI_LOGIN === "1")
    frame.args.push(
      "--extension",
      fileURLToPath(new URL("./pi-auth.mjs", import.meta.url)),
    );
  if (closing) throw new Error("Session closed");
  child = spawn(frame.command, frame.args, {
    cwd: process.cwd(),
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
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
  if (line === '{"type":"stop"}') {
    void close(true).finally(() => {
      lines.close();
      process.stdin.destroy();
    });
    return;
  }
  changing = changing
    .then(async () => {
      if (Buffer.byteLength(line) > 16 * 1024 * 1024)
        throw new Error("Frame too large");
      const frame = JSON.parse(line);
      if (frame.type === "configure") await configure(frame);
      else if (frame.type === "launch") await launch(frame);
      else if (frame.type === "input") child?.stdin.write(frame.data);
      else if (frame.type === "resolve") {
        const { env } = await accountEnvironment({}, home, accountEnv);
        await resolveProgram(frame.command, env).then(
          (result) => emit({ type: "http", id: frame.id, result }),
          (error) => emit({ type: "http", id: frame.id, error: error.message }),
        );
      } else if (frame.type === "tools") {
        void gateway.ready().then(
          () => emit({ type: "http", id: frame.id, result: null }),
          (error) => emit({ type: "http", id: frame.id, error: error.message }),
        );
      } else if (frame.type === "http") {
        if (!http) throw new Error("Service unavailable");
        void http.request(frame);
      } else if (["history", "checkpoint", "account"].includes(frame.type)) {
        void (
          frame.type === "history"
            ? nativeHistory(frame, home)
            : frame.type === "account"
              ? accountFingerprint(frame.provider, accountEnv)
              : nativeCheckpoint(frame, home)
        )
          .then((result) => emit({ type: "http", id: frame.id, result }))
          .catch((error) =>
            emit({
              type: "http",
              id: frame.id,
              error: error.message,
            }),
          );
      } else if (frame.type === "mcp") {
        const controller = new AbortController();
        operations.set(frame.id, controller);
        void manageMcp(frame.input, controller.signal, (progress) =>
          emit({ type: "mcp_progress", id: frame.id, progress }),
        )
          .then((result) => emit({ type: "http", id: frame.id, result }))
          .catch((error) =>
            emit({
              type: "http",
              id: frame.id,
              code:
                error?.constructor?.name === "UnauthorizedError" ||
                error?.code === 401
                  ? "MCP_AUTH"
                  : error instanceof McpError
                    ? error.code
                    : undefined,
              error:
                frame.input.action === "native" || error instanceof McpError
                  ? error.message
                  : "MCP 连接未完成。请检查配置和授权。",
            }),
          )
          .finally(() => operations.delete(frame.id));
      } else if (frame.type === "mcp_cancel") {
        operations.get(frame.id)?.abort();
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
    .catch(async (error) => {
      emit({
        type: "failure",
        code: error.code,
        message: "引擎连接未完成。请检查工作电脑。",
      });
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
