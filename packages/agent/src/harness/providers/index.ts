import type { EngineId, EngineProvider } from "../types.ts";
import { claudeProvider } from "./claude.ts";
import { codexProvider } from "./codex.ts";
import { opencodeProvider } from "./opencode.ts";
import { piProvider } from "./pi.ts";

export const providers: ReadonlyMap<EngineId, EngineProvider> = new Map(
  [piProvider, codexProvider, claudeProvider, opencodeProvider].map(
    (provider) => [provider.id, provider],
  ),
);

export function engineProvider(id: EngineId) {
  const provider = providers.get(id);
  if (!provider) throw new Error("请选择可用的任务引擎。");
  return provider;
}
