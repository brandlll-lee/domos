import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, onTestFinished, test } from "vitest";
import { FilePreviews } from "../src/file-previews.ts";
import { LinkPreviews } from "../src/link-previews.ts";
import { acquireDataLease } from "../src/runtime/lease.ts";
import {
  compactDatabase,
  storageUsage,
  storedBytes,
} from "../src/runtime/maintenance.ts";

test("storage maintenance preserves records and formal files and requires the data lease", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-maintenance-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "agent.sqlite");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE history(text TEXT); INSERT INTO history VALUES ('保留记录'); CREATE TABLE scratch(data BLOB); INSERT INTO scratch VALUES (zeroblob(1048576)); DROP TABLE scratch;",
  );
  db.close();
  const files = `${path}.files`;
  for (const name of [
    "1/artifacts",
    "previews",
    "link-previews",
    "1/workspace",
    "drafts",
    "backups",
  ])
    await mkdir(join(files, name), { recursive: true });
  const formal = join(files, "1/artifacts/file.pdf");
  await writeFile(formal, "正式交付文件");
  await writeFile(join(files, "1/workspace/work.md"), "项目文件");
  await writeFile(join(files, "previews/cover"), "可再生缩略图");
  await writeFile(join(files, "link-previews/link"), "可再生链接预览");
  const usage = await storageUsage(path);
  expect(usage.attachmentBytes).toBe(Buffer.byteLength("正式交付文件"));
  expect(usage.reclaimableBytes).toBeGreaterThan(900_000);
  expect(usage.previewBytes).toBeGreaterThan(0);
  const release = await acquireDataLease(directory);
  try {
    await expect(compactDatabase(path)).rejects.toThrow("独占");
  } finally {
    await release();
  }
  const previews = new FilePreviews(files);
  const links = new LinkPreviews(files, previews);
  await Promise.all([previews.clear(), links.clear()]);
  expect((await storageUsage(path)).previewBytes).toBe(0);
  expect(await readFile(formal, "utf8")).toBe("正式交付文件");
  expect(await readFile(join(files, "1/workspace/work.md"), "utf8")).toBe(
    "项目文件",
  );
  const result = await compactDatabase(path);
  expect(result.reclaimedBytes).toBeGreaterThan(900_000);
  const reopened = new DatabaseSync(path);
  try {
    expect(reopened.prepare("SELECT text FROM history").get()?.text).toBe(
      "保留记录",
    );
  } finally {
    reopened.close();
  }
  expect((await storageUsage(path)).reclaimableBytes).toBe(0);
});

test("storage accounting does not follow directory links", async () => {
  const root = await mkdtemp(join(tmpdir(), "domos-storage-links-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const external = join(root, "external");
  const cache = join(root, "cache");
  await mkdir(external);
  await mkdir(cache);
  await writeFile(join(external, "private.txt"), "private");
  await symlink(
    external,
    join(cache, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(await storedBytes(cache)).toBe(0);
  expect(await readFile(join(external, "private.txt"), "utf8")).toBe("private");
});
