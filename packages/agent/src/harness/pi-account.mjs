import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";

async function read(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export async function seedPiAccount(directory, credentials) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "auth.json");
  try {
    await writeFile(path, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(path, { realpath: false, retries: 10 });
  try {
    const accounts = await read(path);
    const seedsPath = join(directory, ".domos-accounts.json");
    const seeds = await read(seedsPath);
    for (const [provider, credential] of Object.entries(credentials)) {
      const revision = createHash("sha256")
        .update(JSON.stringify(credential))
        .digest("hex");
      if (seeds[provider] === revision && accounts[provider]) continue;
      accounts[provider] = credential;
      seeds[provider] = revision;
    }
    await writeFile(path, JSON.stringify(accounts), { mode: 0o600 });
    await writeFile(seedsPath, JSON.stringify(seeds), { mode: 0o600 });
  } finally {
    await release();
  }
}
