import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAgent } from "@domos/agent";
import { Computers } from "@domos/agent/computer/catalog";
import { parseConfig } from "@domos/agent/config";
import { Files } from "@domos/agent/files";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { onTestFinished } from "vitest";
import { createApp } from "../../src/app.ts";
import type { AppRouter } from "../../src/router.ts";

export const context = BACKGROUND_CONTEXT;

export const botInput = (name: string, modelId = "faux-1") => ({
  name,
  instructions: `Work as ${name}.`,
  model: { provider: "faux", modelId },
  requestId: crypto.randomUUID(),
  avatar: crypto.randomUUID(),
});

export async function setup(staticDir?: string) {
  const directory = await mkdtemp(join(tmpdir(), "domos-api-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const database = join(directory, "agent.sqlite");
  const files = new Files(database);
  const registry = createRegistry();
  registry.install(files.extension());
  const options = {
    models,
    registry,
    env: ({ conversationId }: { conversationId: number }) =>
      files.workspace(conversationId),
  };
  const agent = { model: { provider: "faux", modelId: "faux-1" } };
  const open = async () => {
    const runtime = await openAgent(database, options, agent, context);
    const computer = new Computers(
      parseConfig({ model: agent.model, dataDir: directory }, database),
    );
    await computer.initialize(runtime.harness, runtime.bots, context, true);
    const app = createApp(
      runtime.bots,
      models,
      runtime.files,
      runtime.work,
      computer,
      staticDir,
    );
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({
        url: "http://localhost/rpc",
        fetch: async (request, init) => app.fetch(new Request(request, init)),
      }),
    );
    return { ...runtime, client, app };
  };
  return { faux, open, models };
}
