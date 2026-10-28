import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const serviceKey = /^(DOMOS_|SERVICE_)|^DATABASE_URL$/i;

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
