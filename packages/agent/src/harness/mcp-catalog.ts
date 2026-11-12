import { z } from "zod";
import type {
  EngineConfig,
  EngineMcpCatalog,
  EngineProcess,
  EngineProvider,
} from "./types.ts";
import { engineLimits } from "./types.ts";

export function mcpEntries<T>(schema: z.ZodType<T>, raw: unknown) {
  const entries = z.array(z.unknown()).parse(raw);
  const items: T[] = [];
  const errors: EngineMcpCatalog["errors"] = [];
  for (const [index, entry] of entries.entries()) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) items.push(parsed.data);
    else errors.push({ message: `原生 MCP 第 ${index + 1} 项格式无效。` });
  }
  return { items, errors };
}

export function mcpCatalog(
  items: EngineMcpCatalog["items"],
  scope: EngineMcpCatalog["scope"],
  errors: EngineMcpCatalog["errors"] = [],
): EngineMcpCatalog {
  return {
    items: items.filter((item) => item.name !== "domos"),
    scope,
    errors,
    status: errors.length ? "partial" : "complete",
    observedAt: Date.now(),
  };
}

export function mcpReadError(
  error: unknown,
  scope: EngineMcpCatalog["scope"],
): EngineMcpCatalog {
  const code = (error as { code?: string | number })?.code;
  return {
    ...mcpCatalog([], scope, [
      {
        message:
          error instanceof Error ? error.message : "原生 MCP 目录读取失败。",
        ...(code === undefined ? {} : { code }),
      },
    ]),
    status:
      code === -32601 || code === 404 || code === 405
        ? "unsupported"
        : "failed",
  };
}

export const unsupportedMcp = (): EngineMcpCatalog => ({
  ...mcpCatalog([], "configuration"),
  status: "unsupported",
});

export async function readConfiguredMcp(
  provider: EngineProvider,
  process: EngineProcess,
  config: EngineConfig,
) {
  if (!provider.mcp) return unsupportedMcp();
  try {
    return await provider.mcp({ process, config });
  } catch (error) {
    return mcpReadError(error, "configuration");
  }
}

export async function mcpCommand(
  process: EngineProcess,
  command: string,
  args: string[],
) {
  let output = "";
  let overflow = false;
  process.output.on("data", (chunk) => {
    if (overflow) return;
    output += chunk.toString();
    if (Buffer.byteLength(output) > 1024 * 1024) {
      overflow = true;
      void process.close();
    }
  });
  process.error.resume();
  const timer = setTimeout(
    () => void process.close(),
    engineLimits.handshakeMs,
  );
  timer.unref();
  try {
    await process.launch({ command, args });
    const result = await process.closed;
    if (overflow) throw new Error("原生 MCP 目录响应过大。");
    if (result.code !== 0) throw new Error("原生 MCP 配置读取失败。");
    return JSON.parse(output) as unknown;
  } finally {
    clearTimeout(timer);
  }
}
