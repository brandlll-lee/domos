import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  type DocumentId,
  ROOT_CONVERSATION_ID,
  type Seq,
} from "@earendil-works/pi-durable";
import {
  applySqliteMigrations,
  SQLITE_MIGRATIONS,
  SqliteStorage,
} from "@earendil-works/pi-durable/storage/sqlite";
import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, onTestFinished, test, vi } from "vitest";
import { openStorage } from "../src/runtime/storage.ts";

test("backs up schema v1 before migration and preserves the backup on reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-upgrade-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "agent.sqlite");
  const database = await openNodeSqliteDatabase(file);
  await applySqliteMigrations(database, SQLITE_MIGRATIONS.slice(0, 1));
  await database.close();
  const first = await openStorage(file);
  await first.close(context);
  const second = await openStorage(file);
  await second.close(context);
  for (const [path, version] of [
    [file, 2],
    [`${file}.v1-backup`, 1],
  ] as const) {
    const saved = new DatabaseSync(path, { readOnly: true });
    try {
      expect(
        saved.prepare("SELECT version FROM durable_schema").get()?.version,
      ).toBe(version);
      expect(
        saved.prepare("PRAGMA integrity_check").get()?.integrity_check,
      ).toBe("ok");
    } finally {
      saved.close();
    }
  }
});

test("replays document history in bounded pages and preserves historical reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-storage-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "agent.sqlite");
  const first = await SqliteStorage.open(await openNodeSqliteDatabase(file));
  await first.commit(
    [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
    context,
  );
  const id = await first.mintId<DocumentId>();
  await first.commit(
    [
      {
        type: "document.create",
        record: {
          id,
          kind: "test.replay",
          scope: { kind: "conversation", conversationId: ROOT_CONVERSATION_ID },
          history: "rewindable",
          fork: "asOf",
        },
        content: { kind: "base", version: 1, value: { count: 0 } },
      },
    ],
    context,
  );
  let midpoint: Seq | undefined;
  for (let count = 1; count <= 97; count++) {
    const seq = await first.commit(
      [
        {
          type: "document.change",
          id,
          content: {
            kind: "delta",
            version: 1,
            ops: [["s", ["count"], count]],
          },
        },
      ],
      context,
    );
    if (count === 49) midpoint = seq;
  }
  await first.close(context);
  const database = await openNodeSqliteDatabase(file);
  const transaction = database.transaction.bind(database);
  const pages: number[] = [];
  vi.spyOn(database, "transaction").mockImplementation((read) =>
    transaction((executor) => {
      const all = executor.all.bind(executor);
      vi.spyOn(executor, "all").mockImplementation(async (sql, ...params) => {
        const rows = await all(sql, ...params);
        if (sql.includes("document_revisions")) pages.push(rows.length);
        return rows;
      });
      return read(executor);
    }),
  );
  const storage = await SqliteStorage.open(database);
  try {
    if (midpoint === undefined)
      throw new Error("Missing historical checkpoint");
    expect(await storage.document(id, "current", context)).toMatchObject({
      value: { count: 97 },
      deltasSinceBase: 97,
    });
    expect(await storage.document(id, midpoint, context)).toMatchObject({
      value: { count: 49 },
      deltasSinceBase: 49,
    });
    expect(Math.max(...pages)).toBeLessThanOrEqual(32);
    expect(pages.filter((size) => size > 0).length).toBeGreaterThan(2);
    await database.run(
      "UPDATE document_revisions SET version = 2 WHERE document_id = ? AND seq = (SELECT max(seq) FROM document_revisions WHERE document_id = ?)",
      id,
      id,
    );
    await expect(storage.document(id, "current", context)).rejects.toThrow(
      "version boundary",
    );
  } finally {
    await storage.close(context);
  }
});
