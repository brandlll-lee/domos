import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openBrowserView } from "./browser-view.mjs";

export async function openBrowserService(directory, home) {
  const session = createHash("sha256")
    .update(directory)
    .digest("hex")
    .slice(0, 24);
  const state = join(directory, ".domos");
  await mkdir(state, { recursive: true, mode: 0o700 });
  const profile = join(state, "browser");
  const downloads = join(directory, "downloads");
  await mkdir(downloads, { recursive: true });
  const config = join(state, "browser.json");
  await writeFile(
    config,
    JSON.stringify({
      profile,
      downloadPath: downloads,
      contentBoundaries: true,
      useSystemCa: true,
    }),
    { mode: 0o600 },
  );
  const bin = join(
    dirname(fileURLToPath(import.meta.resolve("agent-browser/package.json"))),
    "bin",
  );
  const os =
    process.platform === "linux" &&
    !process.report.getReport().header.glibcVersionRuntime
      ? "linux-musl"
      : process.platform;
  const extension = process.platform === "win32" ? ".exe" : "";
  let launcher = join(bin, `agent-browser-${os}-${process.arch}${extension}`);
  if (process.platform === "win32" && process.arch === "arm64") {
    try {
      await access(launcher);
    } catch {
      launcher = join(bin, "agent-browser-win32-x64.exe");
    }
  }
  const socket = await mkdtemp(join(tmpdir(), "domos-browser-"));
  const env = Object.fromEntries(
    [
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
      "USERPROFILE",
      "LOCALAPPDATA",
      "APPDATA",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "http_proxy",
      "https_proxy",
      "no_proxy",
      "DISPLAY",
      "XAUTHORITY",
      "XDG_RUNTIME_DIR",
      "AGENT_BROWSER_EXECUTABLE_PATH",
      "AGENT_BROWSER_HEADED",
      "AGENT_BROWSER_ARGS",
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  Object.assign(env, {
    HOME: home,
    ELECTRON_RUN_AS_NODE: "1",
    AGENT_BROWSER_CONFIG: config,
    AGENT_BROWSER_SESSION: session,
    AGENT_BROWSER_SOCKET_DIR: socket,
  });
  const client = new Client({ name: "domos", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: launcher,
        args: ["mcp"],
        env,
        cwd: directory,
        stderr: "ignore",
      }),
    );
  } catch (error) {
    await client.close();
    await rm(socket, { recursive: true, force: true });
    throw error;
  }
  const run = (args, signal) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        launcher,
        ["--config", config, "--session", session, ...args],
        {
          env,
          cwd: directory,
          windowsHide: true,
          signal,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        child.stdout.destroy();
        child.stderr.destroy();
        if (code === 0) resolve(stdout);
        else
          reject(
            new Error(stderr.trim() || stdout.trim() || "浏览器命令未完成。"),
          );
      });
    });
  const stop = async () => {
    const path = join(socket, `${session}.pid`);
    let pid;
    try {
      pid = Number((await readFile(path, "utf8")).trim());
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (!Number.isSafeInteger(pid) || pid < 1 || pid === process.pid)
      throw new Error("浏览器进程身份未确认。");
    if (process.platform === "win32")
      await new Promise((resolve, reject) => {
        const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        child.once("error", reject);
        child.once("exit", resolve);
      });
    else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    const timeout = AbortSignal.timeout(5000);
    while (true) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") return;
        throw error;
      }
      await setTimeout(50, undefined, { signal: timeout });
    }
  };
  const call = async (name, args, signal) => {
    signal.throwIfAborted();
    let draining;
    const abort = () => {
      draining = stop();
      void draining.catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const capturedAt = new Date().toISOString();
      const result = await client.callTool(
        {
          name,
          arguments: {
            ...args,
            session,
            all: false,
            extraArgs: ["--profile", profile, "--download-path", downloads],
          },
        },
        undefined,
        { signal, timeout: 120000 },
      );
      if (result.content.some((part) => part.type === "image")) {
        const page = JSON.parse(await run(["get", "url", "--json"], signal));
        result.structuredContent = {
          ...result.structuredContent,
          source: { capturedAt, url: page.data.url },
        };
      }
      return result;
    } finally {
      signal.removeEventListener("abort", abort);
      if (draining) await draining;
    }
  };
  return {
    async install(signal) {
      await run(["install", "--use-system-ca"], signal);
      return { available: true, error: null };
    },
    async prepare(signal) {
      await run(["get", "url", "--json"], signal);
      return { available: true, error: null };
    },
    async catalog() {
      const tools = [];
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    },
    call,
    view: (signal) => openBrowserView(run, call, signal),
    async close() {
      await run(["close"], AbortSignal.timeout(3000)).catch(stop);
      await client.close();
      await rm(socket, { recursive: true, force: true });
    },
  };
}
