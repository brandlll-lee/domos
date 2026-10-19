import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  Object.assign(env, {
    HOME: home,
    ELECTRON_RUN_AS_NODE: "1",
    AGENT_BROWSER_CONFIG: config,
    AGENT_BROWSER_SESSION: session,
    AGENT_BROWSER_NAMESPACE: session,
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
    throw error;
  }
  const run = (args, signal) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        launcher,
        [
          "--config",
          config,
          "--session",
          session,
          "--namespace",
          session,
          ...args,
        ],
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
        else reject(new Error(stderr.trim() || "浏览器命令未完成。"));
      });
    });
  const call = (name, args, signal) =>
    client.callTool(
      {
        name,
        arguments: {
          ...args,
          session,
          namespace: session,
          extraArgs: ["--profile", profile, "--download-path", downloads],
        },
      },
      undefined,
      { signal, timeout: 120000 },
    );
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
    async close() {
      await run(["close"], AbortSignal.timeout(3000)).catch(() => {});
      await client.close();
    },
  };
}
