import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, extname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const serviceKey = /^(DOMOS_|SERVICE_)|^DATABASE_URL$/i;

export async function resolveProgram(command, env) {
  const windows = process.platform === "win32";
  async function file(path) {
    try {
      if (!(await stat(path)).isFile()) return null;
      await access(path, windows ? constants.F_OK : constants.X_OK);
      return path;
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) return null;
      throw new Error(`程序无法访问：${path} (${error.code})`);
    }
  }
  if (command.startsWith("~/")) command = join(env.HOME, command.slice(2));
  if (isAbsolute(command) || /[\\/]/.test(command)) {
    if (windows && !extname(command)) {
      for (const extension of [".exe", ".cmd", ".com", ".bat"]) {
        const path = await file(command + extension);
        if (path) return path;
      }
    }
    return file(command);
  }
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH");
  if (!windows) {
    for (const directory of (env[pathKey] ?? "").split(delimiter)) {
      if (!isAbsolute(directory)) continue;
      const path = await file(join(directory, command));
      if (path) return path;
    }
  }
  const result = await promisify(execFile)(
    windows ? "where.exe" : env.SHELL || "/bin/sh",
    windows ? [command] : ["-lc", 'command -v "$1"', "domos", command],
    { env, windowsHide: true, timeout: 10000 },
  ).catch((error) => {
    if (error.code === 1 || error.code === 127) return { stdout: "" };
    throw new Error(`程序检测失败 (${error.code ?? "timeout"})`);
  });
  const paths = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  for (const path of windows
    ? paths.filter((path) => /\.(exe|cmd|com|bat)$/i.test(path))
    : paths.filter(isAbsolute)) {
    const found = await file(path);
    if (found) return found;
  }
  return null;
}

export async function accountEnvironment(spec, home, source) {
  const env = Object.fromEntries(
    Object.entries(source).filter(([key]) => !serviceKey.test(key)),
  );
  env.HOME ||= env.USERPROFILE || homedir();
  env.USERPROFILE ||= env.HOME;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = [
    env[pathKey],
    join(env.HOME, ".local", "bin"),
    join(env.HOME, ".npm-global", "bin"),
    ...(env.APPDATA ? [join(env.APPDATA, "npm")] : []),
    join(home, "runtime", "node_modules", ".bin"),
  ]
    .filter(Boolean)
    .join(delimiter);
  if (spec.env?.OPENCODE_CONFIG_CONTENT && env.OPENCODE_CONFIG_CONTENT) {
    const original = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
    const overlay = JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT);
    spec.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      ...original,
      ...overlay,
      instructions: [
        ...new Set([
          ...(original.instructions ?? []),
          ...(overlay.instructions ?? []),
        ]),
      ],
    });
  }
  return { env: Object.assign(env, spec.env) };
}

export async function accountFingerprint(provider, env) {
  const user = env.HOME || env.USERPROFILE || homedir();
  const root = {
    pi: env.PI_CODING_AGENT_DIR || join(user, ".pi", "agent"),
    codex: env.CODEX_HOME || join(user, ".codex"),
    claude: env.CLAUDE_CONFIG_DIR || join(user, ".claude"),
    opencode: join(env.XDG_CONFIG_HOME || join(user, ".config"), "opencode"),
  }[provider];
  const files = {
    pi: ["auth.json", "models.json"],
    codex: ["auth.json", "config.toml"],
    claude: [".credentials.json", "settings.json"],
    opencode: ["opencode.json", "opencode.jsonc"],
  }[provider];
  const paths = (files ?? []).map((file) => join(root, file));
  if (provider === "opencode") {
    paths.push(
      join(
        env.XDG_DATA_HOME || join(user, ".local", "share"),
        "opencode",
        "auth.json",
      ),
    );
    if (env.OPENCODE_CONFIG) paths.push(env.OPENCODE_CONFIG);
  }
  const hash = createHash("sha256");
  for (const [key, value] of Object.entries(env).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    if (
      !serviceKey.test(key) &&
      (/^(?:PI_|OPENAI_|ANTHROPIC_|CLAUDE_|CODEX_|OPENCODE_|AWS_|GOOGLE_|AZURE_)/.test(
        key,
      ) ||
        /(?:KEY|TOKEN|SECRET|PASSWORD)$/.test(key))
    )
      hash.update(JSON.stringify([key, value]));
  for (const path of paths) {
    try {
      hash.update(await readFile(path));
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error("工作电脑的账号配置无法读取。");
    }
  }
  return hash.digest("hex");
}
