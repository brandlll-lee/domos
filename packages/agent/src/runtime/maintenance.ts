import { lstat, readdir, stat, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defineDoc } from "@earendil-works/pi-durable";
import { acquireDataLease } from "./lease.ts";

export const MaintenanceDoc = defineDoc<{ held: boolean }>({
  kind: "domos.maintenance",
  scope: "session",
  version: 1,
  checkpointWhen: () => false,
  initial: () => ({ held: false }),
});

export async function storedBytes(path: string): Promise<number> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info || info.isSymbolicLink()) return 0;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  let bytes = 0;
  for (const entry of await readdir(path))
    bytes += await storedBytes(join(path, entry));
  return bytes;
}
export async function storageUsage(database: string) {
  const root = `${database}.files`;
  let attachments = 0;
  for (const bot of await readdir(root, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  )) {
    if (bot.isDirectory() && /^\d+$/.test(bot.name))
      attachments += await storedBytes(join(root, bot.name, "artifacts"));
  }
  const previewBytes =
    (await storedBytes(join(root, "previews"))) +
    (await storedBytes(join(root, "link-previews")));
  const databaseBytes =
    (await storedBytes(database)) +
    (await storedBytes(`${database}-wal`)) +
    (await storedBytes(`${database}-shm`));
  const exists = await stat(database).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  let reclaimableBytes = 0;
  if (exists) {
    const connection = new DatabaseSync(database, { readOnly: true });
    try {
      reclaimableBytes =
        Number(
          connection.prepare("PRAGMA freelist_count").get()?.freelist_count ??
            0,
        ) *
        Number(connection.prepare("PRAGMA page_size").get()?.page_size ?? 0);
    } finally {
      connection.close();
    }
  }
  return {
    sampledAt: Date.now(),
    databaseBytes,
    reclaimableBytes,
    attachmentBytes: attachments,
    previewBytes,
  };
}
export async function compactDatabase(database: string) {
  const release = await acquireDataLease(dirname(database));
  try {
    const info = await lstat(database);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("数据库路径无效。");
    const disk = await statfs(dirname(database));
    if (disk.bavail * disk.bsize < info.size * 2 + 16 * 1024 * 1024)
      throw new Error("可用空间不足，无法安全整理数据库。");
    const connection = new DatabaseSync(database);
    try {
      connection.exec(
        "PRAGMA busy_timeout=5000; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;",
      );
    } finally {
      connection.close();
    }
    return {
      reclaimedBytes: Math.max(0, info.size - (await stat(database)).size),
    };
  } finally {
    await release();
  }
}
