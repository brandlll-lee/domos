import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export async function acquireDataLease(directory: string) {
  await mkdir(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "runtime.sqlite"));
  try {
    database.exec("PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE");
  } catch {
    database.close();
    throw new Error(
      "数据目录无法独占。请确认其他运行实例已停止，并检查目录权限。",
    );
  }
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    database.close();
  };
}
