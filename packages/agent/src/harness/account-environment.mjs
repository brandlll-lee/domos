import { randomUUID } from "node:crypto";
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
const nativeKeys = [
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "USER",
  "USERNAME",
  "LOGNAME",
  "SHELL",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];
const providerKey =
  /^(OPENAI_|ANTHROPIC_|CLAUDE_|CODEX_|OPENCODE_|PI_|GEMINI_|GOOGLE_|GCLOUD_|AWS_|AZURE_|OPENROUTER_|DEEPSEEK_|GROQ_|MISTRAL_|XAI_|CEREBRAS_|ZAI_|MINIMAX_|MOONSHOT_|KIMI_|QWEN_|FIREWORKS_|TOGETHER_|HF_|VERCEL_|AI_GATEWAY_)/;

export async function accountEnvironment(spec, home, source) {
  let settingsPath;
  const native = spec.accountSource === "native";
  if (spec.accountSource && !["native", "managed"].includes(spec.accountSource))
    throw new Error("Invalid account source");
  const env = Object.fromEntries(
    Object.entries(source).filter(
      ([key]) =>
        inherited.includes(key) ||
        (native && (nativeKeys.includes(key) || providerKey.test(key))),
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
                /^(ANTHROPIC_|CLAUDE_CODE_(USE_|OAUTH_))/.test(key) &&
                typeof value === "string",
            ),
          ),
          ...(typeof settings.apiKeyHelper === "string"
            ? { apiKeyHelper: settings.apiKeyHelper }
            : {}),
          ...(typeof settings.model === "string"
            ? { model: settings.model }
            : {}),
        };
        settingsPath = join(home, `claude-settings-${randomUUID()}.json`);
        await writeFile(settingsPath, JSON.stringify(selected), {
          mode: 0o600,
        });
        spec.args.push("--settings", settingsPath);
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
