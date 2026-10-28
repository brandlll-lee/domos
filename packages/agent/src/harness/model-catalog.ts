import type { Context } from "@earendil-works/chord/context";
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import type { EngineConfig, EngineModel } from "./types.ts";

const Catalog = defineDoc<{
  items: {
    botId: number;
    computerId: string | null;
    provider: EngineConfig["provider"];
    models: EngineModel[];
    version?: string | null;
  }[];
}>({
  kind: "domos.native-models",
  version: 1,
  checkpointWhen: () => false,
  scope: "session",
  initial: () => ({ items: [] }),
});

export class EngineModelCatalog {
  private readonly harness: Harness;
  constructor(harness: Harness) {
    this.harness = harness;
  }

  async read(botId: number, computerId: string | null, context: Context) {
    return (
      (await this.harness.snapshot(Catalog, context))?.items.filter(
        (item) => item.botId === botId && item.computerId === computerId,
      ) ?? []
    );
  }

  async save(
    botId: number,
    computerId: string | null,
    config: EngineConfig,
    catalog: { models: EngineModel[]; version: string | null },
    context: Context,
  ) {
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(Catalog);
      doc.items = doc.items.filter(
        (item) =>
          !(
            item.botId === botId &&
            item.computerId === computerId &&
            item.provider === config.provider
          ),
      );
      doc.items.push({
        botId,
        computerId,
        provider: config.provider,
        ...catalog,
      });
    }, context);
  }

  async invalidate(
    computerId: string | null,
    config: EngineConfig,
    context: Context,
  ) {
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(Catalog);
      doc.items = doc.items.filter(
        (item) =>
          item.provider !== config.provider || item.computerId !== computerId,
      );
    }, context);
  }
}
