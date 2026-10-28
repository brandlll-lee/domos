import { stat } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

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
