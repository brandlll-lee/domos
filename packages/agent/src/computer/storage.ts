import { stat } from "node:fs/promises";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { type ComputerRecord, ComputersDoc } from "./state.ts";

export async function storedComputers(database: string) {
  try {
    await stat(database);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const storage = await openNodeSqliteStorage(database);
  try {
    const record = await storage.findDocument(
      { kind: ComputersDoc.definition.kind, scope: { kind: "session" } },
      "current",
      BACKGROUND_CONTEXT,
    );
    if (!record) return [];
    const doc = await storage.document(
      record.id,
      "current",
      BACKGROUND_CONTEXT,
    );
    if (!doc || doc.version !== ComputersDoc.definition.version)
      throw new Error("电脑目录版本不兼容。");
    return doc.value.items as unknown as ComputerRecord[];
  } finally {
    await storage.close(BACKGROUND_CONTEXT);
  }
}

export async function restoreComputers(
  database: string,
  items: ComputerRecord[],
) {
  if (!items.length) return;
  const harness = await Harness.open(
    await openNodeSqliteStorage(database),
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  );
  try {
    await harness.commit(async (tx) => {
      (await tx.doc(ComputersDoc)).items = items;
    }, BACKGROUND_CONTEXT);
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}
