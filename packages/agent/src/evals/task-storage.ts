import { createHash } from "node:crypto";
import {
  lstat,
  readdir,
  readFile,
  realpath,
  rm,
  statfs,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export async function directoryBytes(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    bytes += entry.isDirectory()
      ? await directoryBytes(path)
      : (await lstat(path)).size;
  }
  return bytes;
}
export async function diskFree(directory: string) {
  const info = await statfs(directory);
  return info.bavail * info.bsize;
}
export async function removeTrialPath(root: string, path: string) {
  const owner = await realpath(root);
  const target = resolve(path);
  const local = relative(owner, target);
  if (
    !local ||
    local === ".." ||
    local.startsWith(`..${sep}`) ||
    isAbsolute(local)
  )
    throw new Error("Cleanup path must be inside the trial directory");
  const parts = local.split(sep);
  for (let index = 1; index <= parts.length; index++) {
    const current = join(owner, ...parts.slice(0, index));
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Cleanup path contains a link");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
  // Windows can release browser handles shortly after the service exits.
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
export async function cleanTrial(directory: string) {
  const before = await directoryBytes(directory);
  const freeBefore = await diskFree(directory);
  // Workspaces contain disposable browser profiles; Files keeps published originals separately.
  const files = join(directory, "agent.sqlite.files");
  for (const entry of await readdir(files, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  )) {
    if (entry.isDirectory() && /^\d+$/.test(entry.name))
      await removeTrialPath(directory, join(files, entry.name, "workspace"));
  }
  await removeTrialPath(directory, join(directory, "engines"));
  const after = await directoryBytes(directory);
  return {
    before,
    after,
    released: before - after,
    freeBefore,
    freeAfter: await diskFree(directory),
  };
}
export async function evidenceInventory(
  directory: string,
): Promise<Record<string, string>> {
  const inventory: Record<string, string> = {};
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Evidence contains a link");
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else
        inventory[relative(directory, full).split(sep).join("/")] = createHash(
          "sha256",
        )
          .update(await readFile(full))
          .digest("hex");
    }
  }
  await walk(directory);
  return inventory;
}

export function evaluationRoot(path: string, repository: string) {
  const root = resolve(path);
  const local = relative(repository, root);
  if (
    !local ||
    (!local.startsWith(`..${sep}`) && local !== ".." && !isAbsolute(local))
  )
    throw new Error("Keep evaluation evidence outside the repository");
  return root;
}
