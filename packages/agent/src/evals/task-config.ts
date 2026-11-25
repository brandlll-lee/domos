import { z } from "zod";
import type { EngineConfig, EngineControls } from "../harness/types.ts";
import { experimentFactor } from "./task-report.ts";

export const evalConfig = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    options: z.record(z.string(), z.string()).default({}),
    approvalMode: z.literal("full").default("full"),
  })
  .strict();

export function validateEvalConfig(
  config: EngineConfig,
  catalog: {
    ready: boolean;
    authenticated?: boolean;
    message?: string;
    models: { id: string; effort?: EngineControls["options"][number] }[];
    controls?: EngineControls;
  },
) {
  if (!catalog.ready || catalog.authenticated === false)
    throw new Error(catalog.message ?? "Harness unavailable");
  const model = catalog.models.find((m) => m.id === config.model);
  if (!model) throw new Error(`Model unavailable: ${config.model}`);
  for (const [id, value] of Object.entries(config.options ?? {})) {
    const control =
      model.effort?.id === id
        ? model.effort
        : catalog.controls?.options.find((c) => c.id === id);
    if (!control?.options.some((option) => option.id === value))
      throw new Error(`Native option unavailable: ${id}=${value}`);
  }
}

export const taskExperiment = z
  .object({
    factor: experimentFactor,
    before: z.object({ target: z.string(), config: evalConfig }),
    after: z.object({ target: z.string(), config: evalConfig }),
  })
  .strict();
