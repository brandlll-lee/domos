import type { Context } from "@earendil-works/chord/context";
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import type { EngineConfig, EngineModel } from "./types.ts";

const Catalog = defineDoc<{
  items: {
    botId: number;
    computerId: string | null;
    provider: EngineConfig["provider"];
    accountSource: NonNullable<EngineConfig["accountSource"]>;
    models: EngineModel[];
  }[];
}>({
  kind: "domos.engine-catalog",
  version: 1,
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
    models: EngineModel[],
    context: Context,
  ) {
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(Catalog);
      doc.items = doc.items.filter(
        (item) =>
          !(
            item.botId === botId &&
            item.computerId === computerId &&
            item.provider === config.provider &&
            (item.accountSource ?? "managed") ===
              (config.accountSource ?? "managed")
          ),
      );
      doc.items.push({
        botId,
        computerId,
        provider: config.provider,
        accountSource: config.accountSource ?? "managed",
        models,
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
          item.provider !== config.provider ||
          (config.accountSource === "native" && item.computerId !== computerId),
      );
    }, context);
  }
}
