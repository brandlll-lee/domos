import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { onTestFinished } from "vitest";
import type { Computers } from "../../src/computer/catalog.ts";
import { openAgent } from "../../src/open-agent.ts";

export async function runtimeFixture(computers?: Computers) {
  const directory = await mkdtemp(join(tmpdir(), "domos-durable-"));
  const database = join(directory, "agent.sqlite");
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const options = { models, registry, computers };
  const agent = { model: { provider: "faux", modelId: "faux-1" } };
  let current = await openAgent(database, options, agent, context);
  onTestFinished(async () => {
    await current.harness.close(context);
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  });
  return {
    ...current,
    directory,
    database,
    faux,
    models,
    registry,
    async reopen() {
      await current.harness.close(context);
      current = await openAgent(database, options, agent, context);
      return current;
    },
  };
}
