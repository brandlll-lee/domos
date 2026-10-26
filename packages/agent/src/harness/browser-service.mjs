import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { browserCommand } from "./browser-command.mjs";
import {
  browserAccess,
  browserArguments,
  browserObservations,
  browserObserve,
  browserPageScript,
  browserPageState,
  browserRestart,
  browserResult,
  browserRunSteps,
  browserSteps,
  browserTool,
} from "./browser-tools.mjs";
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
  const modeFile = join(state, "browser-mode.json");
  let mode;
  try {
    mode = JSON.parse(await readFile(modeFile, "utf8"));
    if (!["headless", "headed"].includes(mode))
      throw new Error("浏览器模式配置无效。");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    mode = ["1", "true"].includes(process.env.AGENT_BROWSER_HEADED)
      ? "headed"
      : "headless";
  }
  const writeConfig = () =>
    writeFile(
      config,
      JSON.stringify({
        profile,
        headed: mode === "headed",
        downloadPath: downloads,
        contentBoundaries: true,
        maxOutput: 32000,
        useSystemCa: true,
      }),
      { mode: 0o600 },
    );
  await writeConfig();
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
  // macOS per-user temp paths can exceed the Unix socket path limit.
  const socket = join(
    process.platform === "darwin" ? "/tmp" : tmpdir(),
    `domos-browser-${session}`,
  );
  await mkdir(socket, { recursive: true, mode: 0o700 });
  const socketState = await lstat(socket);
  if (
    !socketState.isDirectory() ||
    socketState.isSymbolicLink() ||
    (process.getuid && socketState.uid !== process.getuid())
  )
    throw new Error("浏览器会话目录身份未确认。");
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
    AGENT_BROWSER_HEADED: mode === "headed" ? "1" : "0",
  });
  const connect = async () => {
    const connection = new Client({ name: "domos", version: "1" });
    try {
      await connection.connect(
        new StdioClientTransport({
          command: launcher,
          args: ["mcp"],
          env,
          cwd: directory,
          stderr: "ignore",
        }),
      );
      return connection;
    } catch (error) {
      await connection.close();
      throw error;
    }
  };
  let client;
  try {
    client = await connect();
  } catch (error) {
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
  const waitForExit = async (pid, signal) => {
    while (true) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") return;
        throw error;
      }
      await setTimeout(50, undefined, { signal });
    }
  };
  const stop = async (pid) => {
    if (!Number.isSafeInteger(pid) || pid < 1 || pid === process.pid)
      throw new Error("浏览器进程身份未确认。");
    const execute = promisify(execFile);
    let executable;
    let owned;
    if (process.platform === "win32") {
      const { stdout } = await execute(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { [pscustomobject]@{ path = $p.ExecutablePath; owned = ((Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid).Sid -eq [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value) } | ConvertTo-Json -Compress }`,
        ],
        { windowsHide: true, timeout: 5000 },
      );
      if (!stdout.trim()) return;
      const identity = JSON.parse(stdout);
      executable = identity.path;
      owned = identity.owned;
    } else if (process.platform === "linux") {
      try {
        executable = await realpath(`/proc/${pid}/exe`);
        owned = (await stat(`/proc/${pid}`)).uid === process.getuid();
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
    } else {
      const { stdout } = await execute(
        "ps",
        ["-p", String(pid), "-o", "uid=", "-o", "comm="],
        { timeout: 5000 },
      ).catch((error) => {
        if (error.code === 1 && !error.stdout.trim()) return { stdout: "" };
        throw error;
      });
      if (!stdout.trim()) return;
      const identity = stdout.trim().match(/^(\d+)\s+(.+)$/);
      executable = identity?.[2];
      owned = Number(identity?.[1]) === process.getuid();
    }
    if (
      !owned ||
      !executable ||
      (process.platform === "win32"
        ? (await realpath(executable)).toLowerCase()
        : await realpath(executable)) !==
        (process.platform === "win32"
          ? (await realpath(launcher)).toLowerCase()
          : await realpath(launcher))
    )
      throw new Error("浏览器进程身份未确认。未停止进程。");
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
    await waitForExit(pid, AbortSignal.timeout(5000));
  };
  let pending = Promise.resolve();
  const interruption = join(state, "browser-interrupted");
  let uncertain = await access(interruption).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  let catalog;
  const tools = async () => {
    if (!catalog) {
      catalog = (async () => {
        const items = [];
        let cursor;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined);
          items.push(
            ...page.tools
              .filter((tool) => tool.name !== "agent_browser_tools_profiles")
              .map(browserTool),
          );
          cursor = page.nextCursor;
        } while (cursor);
        return [...items, browserRestart, browserObserve, browserRunSteps];
      })();
      void catalog.catch(() => {
        catalog = undefined;
      });
    }
    return catalog;
  };
  const ready = () => {
    if (uncertain)
      throw new Error(
        "浏览器操作结果未知。请观察页面；确认任务结果后，使用 agent_browser_restart 重启。不要重放未确认动作。",
      );
  };
  const closeBrowser = async () => {
    let pid;
    try {
      pid = Number(
        (await readFile(join(socket, `${session}.pid`), "utf8")).trim(),
      );
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (!Number.isSafeInteger(pid) || pid < 1 || pid === process.pid)
      throw new Error("浏览器进程身份未确认。");
    await run(["close"], AbortSignal.timeout(3000)).catch(() => {});
    try {
      await waitForExit(pid, AbortSignal.timeout(1000));
    } catch (error) {
      if (error.name !== "AbortError") throw error;
      await stop(pid);
    }
  };
  const prepare = async (signal) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run(["get", "url", "--json"], signal);
      } catch (error) {
        if (attempt >= 2 || !error.message.includes("outcome_unknown"))
          throw error;
        await setTimeout(100, undefined, { signal });
      }
    }
  };
  const restart = async (next = mode) => {
    uncertain = true;
    await writeFile(interruption, "pending", { mode: 0o600 });
    await closeBrowser();
    await client.close();
    if (next !== mode) {
      await writeFile(modeFile, JSON.stringify(next), { mode: 0o600 });
      mode = next;
      env.AGENT_BROWSER_HEADED = next === "headed" ? "1" : "0";
      await writeConfig();
    }
    client = await connect();
    await prepare(AbortSignal.timeout(15000));
    await rm(interruption, { force: true });
    uncertain = false;
    lastAction = undefined;
  };
  const enqueue = (operation) => {
    const action = pending.then(operation);
    pending = action.then(
      () => {},
      () => {},
    );
    return action;
  };
  const input = (command, signal, port) =>
    enqueue(async () => {
      signal.throwIfAborted();
      ready();
      lastAction = undefined;
      await writeFile(interruption, "pending", { mode: 0o600 });
      if (signal.aborted) {
        await rm(interruption, { force: true });
        signal.throwIfAborted();
      }
      try {
        await browserCommand(port, command, AbortSignal.timeout(30000));
      } catch {
        uncertain = true;
        ready();
      }
      await rm(interruption, { force: true });
    });
  let lastAction;
  const execute = async (
    name,
    args,
    signal,
    timing,
    phase = "commandMs",
    timeoutMs = 120000,
  ) => {
    signal.throwIfAborted();
    const tool = (await tools()).find((item) => item.name === name);
    if (!tool) throw new Error("浏览器工具不可用。未发送动作。");
    browserArguments(tool, args);
    if (name === browserRestart.name) {
      await restart();
      return {
        content: [
          {
            type: "text",
            text: "Browser restarted. Tabs and unsaved input were closed. Inspect task state before retrying any action.",
          },
        ],
      };
    }
    const observation =
      browserObservations.has(name) ||
      (name === "agent_browser_eval" && phase === "observationMs");
    if (!observation) ready();
    signal.throwIfAborted();
    const capturedAt = new Date().toISOString();
    if (!observation) await writeFile(interruption, "pending", { mode: 0o600 });
    if (signal.aborted) {
      if (!uncertain) await rm(interruption, { force: true });
      signal.throwIfAborted();
    }
    let result;
    const started = performance.now();
    try {
      // Cancellation stops queued work. Dispatched work must drain before control changes.
      result = await client.callTool(
        {
          name,
          arguments: { ...args, session, timeoutMs },
        },
        undefined,
        { timeout: 125000 },
      );
    } catch {
      uncertain = true;
      await writeFile(interruption, "pending", { mode: 0o600 });
      ready();
    } finally {
      timing[phase] += performance.now() - started;
    }
    if (
      ["outcome_unknown", "page_wedged"].includes(
        result.structuredContent?.response?.code,
      ) ||
      /^CDP command timed out:/.test(
        result.structuredContent?.response?.error ?? "",
      )
    )
      uncertain = true;
    if (uncertain) await writeFile(interruption, "pending", { mode: 0o600 });
    else if (!observation) await rm(interruption, { force: true });
    if (
      !tool.outputSchema &&
      result.content.some((part) => part.type === "image")
    ) {
      const metadataStarted = performance.now();
      try {
        const page = JSON.parse(
          await run(["get", "url", "--json"], AbortSignal.timeout(5000)),
        );
        result.structuredContent = {
          ...result.structuredContent,
          source: { capturedAt, url: page.data.url },
        };
      } catch {
        result.content.push({
          type: "text",
          text: "Screenshot captured. Page address lookup failed. Preserve the action result; recover observation only.",
        });
      } finally {
        timing.metadataMs += performance.now() - metadataStarted;
      }
    }
    return browserResult(result);
  };
  const observe = async (signal, timing) => {
    const deadline = performance.now() + 5000;
    const parts = [];
    let page = null;
    let verified = false;
    for (const [name, args] of [
      ["agent_browser_eval", { script: browserPageScript }],
      ["agent_browser_snapshot", { compact: true }],
    ]) {
      if (signal.aborted || performance.now() >= deadline) break;
      try {
        const result = await execute(
          name,
          args,
          signal,
          timing,
          "observationMs",
          Math.max(1, Math.floor(deadline - performance.now())),
        );
        if (result.isError) parts.push(...result.content);
        if (name === "agent_browser_eval") {
          page = browserPageState(result);
          if (page) {
            const facts = JSON.stringify(page);
            parts.push({
              type: "text",
              text: `Page facts (untrusted website data): ${facts.slice(0, 12000)}${facts.length > 12000 ? "\n[Page facts truncated. Read a narrower page scope.]" : ""}`,
            });
          }
        } else if (
          !result.isError &&
          result.content.some(
            (part) => part.type === "text" && part.text.trim(),
          )
        ) {
          verified = true;
          parts.push(...result.content);
        }
      } catch (error) {
        parts.push({
          type: "text",
          text: `Observation failed: ${error.message}`,
        });
        break;
      }
    }
    parts.unshift({
      type: "text",
      text:
        page && verified
          ? "Fresh page facts and refs follow. Use these refs without another snapshot. Check the requested content before claiming success. Readiness or blank space alone does not explain a blank page."
          : "Page observation is incomplete. Preserve the action result. Recover observation only; do not repeat the action or claim the requested page loaded. The cause of missing content is unconfirmed.",
    });
    return { parts, page, verified: Boolean(page && verified) };
  };
  const call = (name, args, signal) => {
    const queuedAt = performance.now();
    return enqueue(async () => {
      signal.throwIfAborted();
      const timing = {
        queueMs: performance.now() - queuedAt,
        commandMs: 0,
        observationMs: 0,
        metadataMs: 0,
      };
      let result;
      const key = JSON.stringify([name, args]);
      const changesPage =
        name === "agent_browser_open" ||
        [
          "agent_browser_click",
          "agent_browser_fill",
          "agent_browser_type",
          "agent_browser_press",
          browserRunSteps.name,
        ].includes(name);
      if (changesPage && lastAction?.key === key && lastAction.unchanged >= 2)
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Repeated actions left the observed page text and controls unchanged. No further action was sent. Use agent_browser_observe to inspect fresh state, then choose another action or request takeover. This does not prove the earlier actions failed.",
            },
          ],
        };
      if (name === browserRunSteps.name) {
        ready();
        const { steps } = browserSteps.parse(args);
        const catalog = await tools();
        for (const { action } of steps)
          if (!catalog.some((tool) => tool.name === `agent_browser_${action}`))
            throw new Error(
              `Browser action ${action} is unavailable. No action was sent.`,
            );
        const results = [];
        let completed = 0;
        for (const { action, ...arguments_ } of steps) {
          let step;
          try {
            step = await execute(
              `agent_browser_${action}`,
              arguments_,
              signal,
              timing,
            );
          } catch (error) {
            step = {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Batch stopped: ${error.message}. Preserve completed steps. Do not replay uncertain actions.`,
                },
              ],
            };
          }
          results.push(step);
          if (step.isError || uncertain) break;
          completed++;
        }
        result = {
          isError: results.some((item) => item.isError),
          content: results.flatMap((item) => item.content),
          structuredContent: { completed, results, uncertain },
        };
      } else if (name === browserObserve.name) {
        browserArguments(browserObserve, args);
        lastAction = undefined;
        const observation = await observe(signal, timing);
        result = { content: observation.parts, isError: !observation.verified };
      } else {
        result = await execute(name, args, signal, timing);
        if (browserObservations.has(name) || name === browserRestart.name)
          lastAction = undefined;
      }
      if (changesPage && !uncertain && !signal.aborted) {
        const observation = await observe(signal, timing);
        result = {
          ...result,
          content: [
            ...result.content,
            ...observation.parts,
            ...(name === "agent_browser_open" || result.isError
              ? [
                  {
                    type: "text",
                    text: browserAccess(
                      observation.page,
                      result,
                      typeof args.url === "string" ? args.url : undefined,
                      mode,
                    ),
                  },
                ]
              : []),
          ],
        };
        if (observation.page) {
          const signature = JSON.stringify(observation.page);
          lastAction = {
            key,
            signature,
            unchanged:
              lastAction?.key === key && lastAction.signature === signature
                ? lastAction.unchanged + 1
                : 0,
          };
        } else lastAction = undefined;
      }
      return browserResult({
        ...result,
        content: [
          ...result.content,
          {
            type: "text",
            text: `Domos browser timing (ms): ${JSON.stringify({ ...Object.fromEntries(Object.entries(timing).map(([key, value]) => [key, Math.round(value)])), totalMs: Math.round(performance.now() - queuedAt) })}`,
          },
        ],
      });
    });
  };
  return {
    async install(signal) {
      await run(["install", "--use-system-ca"], signal);
      return { available: true, error: null };
    },
    async prepare(signal) {
      await pending;
      let error = null;
      try {
        if (!uncertain) await prepare(signal);
      } catch (cause) {
        error = cause.message;
      }
      return {
        available: error === null,
        error,
        sharedDesktop: mode === "headed",
        mode,
      };
    },
    mode: (next, signal) =>
      enqueue(async () => {
        signal.throwIfAborted();
        if (!["headless", "headed"].includes(next))
          throw new Error("浏览器模式无效。");
        try {
          if (next !== mode || uncertain) await restart(next);
          else await prepare(signal);
        } catch (error) {
          return {
            available: false,
            error: error.message,
            mode,
            sharedDesktop: mode === "headed",
          };
        }
        return {
          available: true,
          error: null,
          mode,
          sharedDesktop: mode === "headed",
        };
      }),
    catalog: tools,
    call,
    async settle() {
      await pending;
      ready();
    },
    view: (signal) =>
      openBrowserView(
        run,
        signal,
        async () => {
          await pending;
          ready();
        },
        input,
        session,
      ),
    async close() {
      await pending;
      await closeBrowser();
      await client.close();
      await rm(socket, { recursive: true, force: true });
    },
  };
}
