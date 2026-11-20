import type { EngineOpen } from "../types.ts";

export function readAccountQuota({
  process,
  config,
}: Pick<EngineOpen, "process" | "config">) {
  if (!process.quota)
    throw new Error("工作电脑尚未提供账号额度读取。请更新后台。");
  return process.quota(config.provider, config.command ?? config.provider);
}
