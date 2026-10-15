import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { expect, onTestFinished, test } from "vitest";
import { MAX_FILE_BYTES } from "../src/attachments.ts";
import { Files } from "../src/files.ts";

const context = BACKGROUND_CONTEXT;

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "domos-files-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const files = new Files(join(directory, "agent.sqlite"));
  return { directory, files, workspace: await files.workspace(1) };
}

test("file capabilities reject traversal, absolute escape, junctions, hard links, and alternate streams", async () => {
  const { directory, files, workspace } = await setup();
  const outside = join(directory, "outside");
  await mkdir(outside);
  const original = crypto.randomUUID();
  await writeFile(join(outside, "source.txt"), original);
  await symlink(outside, join(workspace.cwd, "linked"), "junction");
  await link(join(outside, "source.txt"), join(workspace.cwd, "hard.txt"));
  for (const path of [
    "../escape.txt",
    join(outside, "source.txt"),
    "linked/source.txt",
    "hard.txt",
    "valid.txt:stream",
    ".. /escape.txt",
  ]) {
    expect((await workspace.absolutePath(path, context)).ok).toBe(false);
    expect((await workspace.writeFile(path, "changed", context)).ok).toBe(
      false,
    );
    expect((await workspace.readTextFile(path, context)).ok).toBe(false);
    expect(
      (await workspace.openBinaryReader(path, undefined, context)).ok,
    ).toBe(false);
    await expect(files.publish(1, path, context)).rejects.toThrow();
  }
  expect(await readFile(join(outside, "source.txt"), "utf8")).toBe(original);
  const other = await files.workspace(2);
  expect(
    (await workspace.readTextFile(join(other.cwd, "file.txt"), context)).ok,
  ).toBe(false);
});

test("file limits apply to uploaded, generated, and published files", async () => {
  const { workspace, files } = await setup();
  const bytes = new Uint8Array(MAX_FILE_BYTES + 1);
  expect((await workspace.writeFile("large.txt", bytes, context)).ok).toBe(
    false,
  );
  await expect(files.upload(1, "large.txt", bytes)).rejects.toThrow("10 MiB");
  await writeFile(join(workspace.cwd, "large.txt"), bytes);
  await expect(files.publish(1, "large.txt", context)).rejects.toThrow(
    "10 MiB",
  );
  await expect(files.upload(1, "bad:stream", new Uint8Array())).rejects.toThrow(
    "Invalid file name",
  );
});
