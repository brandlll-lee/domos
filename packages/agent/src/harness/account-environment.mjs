import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

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
const serviceKey = /^(DOMOS_|SERVICE_)|^DATABASE_URL$/i;

export async function accountEnvironment(spec, home, source) {
  let settingsPath;
  const native = spec.accountSource === "native";
  if (spec.accountSource && !["native", "managed"].includes(spec.accountSource))
    throw new Error("Invalid account source");
  const env = Object.fromEntries(
    Object.entries(source).filter(
      ([key]) => inherited.includes(key) || (native && !serviceKey.test(key)),
    ),
  );
  if (!native) Object.assign(env, { HOME: home, USERPROFILE: home });
  else {
    env.HOME ||= env.USERPROFILE || homedir();
    env.USERPROFILE ||= env.HOME;
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const pathKey =
      Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = [
      env[pathKey],
      join(env.HOME, ".local", "bin"),
      join(env.HOME, ".npm-global", "bin"),
      ...(env.APPDATA ? [join(env.APPDATA, "npm")] : []),
    ]
      .filter(Boolean)
      .join(delimiter);
    if (spec.command === "claude") {
      let settings;
      try {
        settings = JSON.parse(
          await readFile(
            join(
              env.CLAUDE_CONFIG_DIR || join(env.HOME, ".claude"),
              "settings.json",
            ),
            "utf8",
          ),
        );
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new Error("原生 Claude 配置无法读取。请检查工作电脑。");
      }
      if (settings) {
        const selected = {
          env: Object.fromEntries(
            Object.entries(settings.env ?? {}).filter(
              ([key, value]) =>
                !serviceKey.test(key) && typeof value === "string",
            ),
          ),
          ...Object.fromEntries(
            ["apiKeyHelper", "awsAuthRefresh", "awsCredentialExport", "model"]
              .filter((key) => typeof settings[key] === "string")
              .map((key) => [key, settings[key]]),
          ),
        };
        settingsPath = join(home, `claude-settings-${randomUUID()}.json`);
        await writeFile(settingsPath, JSON.stringify(selected), {
          mode: 0o600,
        });
        spec.args.unshift("--settings", settingsPath);
      }
    }
    if (
      spec.command === "opencode" &&
      env.OPENCODE_CONFIG_CONTENT &&
      spec.env?.OPENCODE_CONFIG_CONTENT
    ) {
      try {
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
      } catch {
        throw new Error("原生 OpenCode 配置无法读取。请检查工作电脑。");
      }
    }
  }
  return { env: Object.assign(env, spec.env), settingsPath };
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
  if (!files) throw new Error("不支持此引擎的账号标识。");
  const paths = files.map((file) => join(root, file));
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
