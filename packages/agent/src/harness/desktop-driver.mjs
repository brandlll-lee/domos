import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CuaDriver, EmbeddedCuaDriverHost } from "@trycua/cua-driver";
import { installCursorTheme } from "./cursor-theme.mjs";

const run = promisify(execFile);
export async function desktopBinary(home) {
  const { version } = JSON.parse(
    await readFile(
      new URL("../package.json", import.meta.resolve("@trycua/cua-driver")),
      "utf8",
    ),
  );
  const executable =
    process.platform === "win32" ? "cua-driver.exe" : "cua-driver";
  const cache = join(home, ".domos", "runtimes", "cua-driver", version);
  const located = await run(
    process.platform === "win32" ? "where.exe" : "which",
    [executable],
    { windowsHide: true },
  ).catch(() => ({ stdout: "" }));
  const candidates = [
    ...located.stdout.trim().split(/\r?\n/).filter(Boolean),
    join(homedir(), ".cua-driver", "packages", "current", executable),
    ...(process.platform === "darwin"
      ? ["/Applications/CuaDriver.app/Contents/MacOS/cua-driver"]
      : []),
    ...(process.platform === "win32"
      ? [
          join(
            homedir(),
            "AppData",
            "Local",
            "Programs",
            "CuaDriver",
            executable,
          ),
        ]
      : []),
    fileURLToPath(new URL(`./cua-driver/${executable}`, import.meta.url)),
    join(homedir(), ".domos", "runtimes", "cua-driver", version, executable),
    join(cache, executable),
  ];
  let binary;
  for (const candidate of candidates) {
    const result = await run(candidate, ["--version"], {
      windowsHide: true,
      timeout: 5000,
    }).catch(() => null);
    if (result?.stdout.trim() === `cua-driver ${version}`) {
      binary = candidate;
      break;
    }
  }
  if (!binary) {
    const platform = { win32: "windows", darwin: "darwin", linux: "linux" }[
      process.platform
    ];
    const arch = { x64: "x86_64", arm64: "arm64" }[process.arch];
    if (!platform || !arch) throw new Error("当前平台不支持 Cua 原生宿主。");
    const suffix =
      platform === "windows"
        ? `${arch}-binary.zip`
        : platform === "darwin"
          ? "universal-binary.tar.gz"
          : `${arch}-binary.tar.gz`;
    const name = `cua-driver-rs-${version}-${platform}-${suffix}`;
    const response = await fetch(
      `https://api.github.com/repos/trycua/cua/releases/tags/cua-driver-rs-v${version}`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok) throw new Error(`Cua release: HTTP ${response.status}`);
    const release = await response.json();
    const asset = release.assets.find((item) => item.name === name);
    if (!/^sha256:[a-f0-9]{64}$/.test(asset?.digest ?? ""))
      throw new Error("Cua 发布缺少校验值。");
    await mkdir(cache, { recursive: true });
    const archive = join(cache, name);
    if (process.platform === "win32") {
      const quote = (value) => `'${value.replaceAll("'", "''")}'`;
      const script = `$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri ${quote(asset.browser_download_url)} -OutFile ${quote(archive)}`;
      await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        { windowsHide: true, timeout: 125000 },
      );
    } else {
      await run(
        "curl",
        [
          "--fail",
          "--location",
          "--silent",
          "--show-error",
          "--max-time",
          "120",
          "--output",
          archive,
          asset.browser_download_url,
        ],
        { windowsHide: true, timeout: 125000 },
      );
    }
    const bytes = await readFile(archive);
    if (
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
      asset.digest
    )
      throw new Error("Cua download checksum mismatch.");
    await run(
      process.platform === "win32"
        ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
        : "tar",
      ["-xf", archive, "-C", cache],
      { windowsHide: true },
    );
    await rm(archive);
    binary = join(cache, executable);
    await access(binary);
  }
  return binary;
}

export async function openDesktopDriver(home) {
  const binary = await desktopBinary(home);
  const themes = new Map();
  const host = new EmbeddedCuaDriverHost(binary, "com.domos.desktop");
  const client = new Client({ name: "domos-computer", version: "1" });
  try {
    const connection = await host.start();
    await client.connect(
      new StdioClientTransport({
        command: connection.mcp.command,
        args: connection.mcp.args,
        stderr: "ignore",
      }),
    );
    const driver = CuaDriver.connect(connection.socketPath);
    return {
      driver,
      client,
      async theme(color, session, signal) {
        if (!themes.has(color))
          themes.set(color, installCursorTheme(binary, home, color));
        const themeId = await themes.get(color);
        signal.throwIfAborted();
        const result = await client.callTool(
          {
            name: "set_agent_cursor_theme",
            arguments: {
              ...(session ? { session } : {}),
              theme_id: themeId,
              reduced_motion: "auto",
            },
          },
          undefined,
          { signal },
        );
        if (result.isError) throw new Error(JSON.stringify(result.content));
      },
      async close() {
        try {
          await client.close();
          await driver.shutdown();
        } finally {
          driver.uniffiDestroy();
          await host.stop();
          host.uniffiDestroy();
        }
      },
    };
  } catch (error) {
    await client.close();
    await host.stop();
    host.uniffiDestroy();
    throw error;
  }
}
