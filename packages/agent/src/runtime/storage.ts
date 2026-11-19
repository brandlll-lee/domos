import { stat } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import type { Context } from "@earendil-works/chord/context";
import type { Cursor, Storage, StorageWrite } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { EngineDoc, engineCheckpointInterval } from "../harness/state.ts";

export async function checkpointEngineState(
  storage: Storage,
  context: Context,
) {
  let cursor: Cursor | undefined;
  do {
    const page = await storage.scanConversations({}, 64, cursor, context);
    const writes: StorageWrite[] = [];
    for (const { id: conversationId } of page.items) {
      const record = await storage.findDocument(
        {
          kind: EngineDoc.definition.kind,
          scope: { kind: "conversation", conversationId },
        },
        "current",
        context,
      );
      if (!record) continue;
      const doc = await storage.document(record.id, "current", context);
      if (doc && doc.deltasSinceBase > engineCheckpointInterval)
        writes.push({
          type: "document.change",
          id: record.id,
          content: { kind: "base", version: doc.version, value: doc.value },
        });
    }
    if (writes.length) await storage.commit(writes, context);
    cursor = page.next;
  } while (cursor);
}

export async function openStorage(path: string) {
  const exists = await stat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return false;
    },
  );
  if (exists) {
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      const table = database
        .prepare("SELECT name FROM sqlite_master WHERE name = 'durable_schema'")
        .get();
      if (table) {
        const version = database
          .prepare("SELECT max(version) AS version FROM durable_schema")
          .get()?.version;
        if (version === 1) {
          const target = `${path}.v1-backup`;
          const saved = await stat(target).then(
            () => true,
            (error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
              return false;
            },
          );
          if (!saved) await backup(database, target);
        }
      }
    } finally {
      database.close();
    }
  }
  return openNodeSqliteStorage(path);
}
