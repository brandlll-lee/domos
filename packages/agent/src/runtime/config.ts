import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const identifier = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,62}$/);
const ssh = z
  .object({
    host: z
      .string()
      .min(1)
      .regex(/^[^\s-][^\s]*$/),
    user: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .optional(),
    port: z.number().int().min(1).max(65535).optional(),
    identityFile: z.string().min(1).optional(),
    knownHostsFile: z.string().min(1),
    hostKeyAlias: identifier,
    configFile: z.string().min(1).optional(),
  })
  .strict();

export const computerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("process") }).strict(),
  z
    .object({
      kind: z.literal("docker"),
      id: identifier,
      image: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]+$/),
      volume: identifier,
      network: z.enum(["none", "restricted"]).default("none"),
      cpus: z.number().positive().default(2),
      memoryMiB: z.number().int().min(128).default(1024),
      pids: z.number().int().min(16).default(256),
      timeoutSeconds: z.number().int().positive().default(120),
      ssh: ssh.optional(),
    })
    .strict(),
]);

const schema = z
  .object({
    model: z
      .object({ provider: z.string().min(1), modelId: z.string().min(1) })
      .strict(),
    host: z.string().min(1).default("127.0.0.1"),
    port: z.coerce.number().int().min(1).max(65535).default(4310),
    dataDir: z.string().min(1).default("data"),
    staticDir: z.string().min(1).optional(),
    deployment: z.enum(["native", "container"]).default("native"),
    computer: computerSchema.default({ kind: "process" }),
  })
  .strict();

export type ComputerConfig = z.infer<typeof computerSchema>;
export type DockerConfig = Extract<ComputerConfig, { kind: "docker" }>;
export type RuntimeConfig = ReturnType<typeof parseConfig>;

export function parseConfig(
  input: unknown,
  filename: string,
  overrides: Record<string, string | undefined> = {},
) {
  const value = schema.parse({
    ...(typeof input === "object" && input !== null ? input : {}),
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => value !== undefined),
    ),
  });
  const base = dirname(resolve(filename));
  const path = (value: string) =>
    isAbsolute(value) ? value : resolve(base, value);
  if (value.computer.kind === "docker" && value.computer.ssh) {
    const target = value.computer.ssh;
    target.knownHostsFile = path(target.knownHostsFile);
    if (target.identityFile) target.identityFile = path(target.identityFile);
    if (target.configFile) target.configFile = path(target.configFile);
  }
  return {
    ...value,
    dataDir: path(value.dataDir),
    staticDir: value.staticDir
      ? path(value.staticDir)
      : fileURLToPath(new URL("../../../../apps/web/dist", import.meta.url)),
  };
}

export async function loadConfig() {
  const filename =
    process.env.DOMOS_CONFIG ??
    fileURLToPath(new URL("../../../../domos.config.json", import.meta.url));
  return parseConfig(JSON.parse(await readFile(filename, "utf8")), filename, {
    host: process.env.DOMOS_HOST,
    port: process.env.DOMOS_PORT,
    dataDir: process.env.DOMOS_DATA_DIR,
    staticDir: process.env.DOMOS_STATIC_DIR,
    deployment: process.env.DOMOS_DEPLOYMENT,
  });
}
