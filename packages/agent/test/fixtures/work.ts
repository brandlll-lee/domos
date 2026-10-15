import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { onTestFinished } from "vitest";
import { Files } from "../../src/files.ts";
import { openAgent } from "../../src/open-agent.ts";
export const context = BACKGROUND_CONTEXT;
export const agent = { model: { provider: "faux", modelId: "faux-1" } };
export const skillContent =
  "---\nname: weekly-report\ndescription: >-\n  Create a concise report\n  with a final check.\nmetadata:\n  author: Domos\n---\n\nRead the saved report preference. Write report.md. Publish the file.\n";

export async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "domos-work-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, "agent.sqlite");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  let now = Date.parse("2026-10-15T00:00:00Z");
  const files = new Files(database);
  const open = () => {
    const registry = createRegistry();
    registry.install(files.extension());
    return openAgent(
      database,
      {
        models,
        registry,
        now: () => now,
        env: ({ conversationId }) => files.workspace(conversationId),
      },
      agent,
      context,
    );
  };
  return {
    open,
    faux,
    advance: (time: number) => {
      now = time;
    },
    now: () => now,
  };
}
