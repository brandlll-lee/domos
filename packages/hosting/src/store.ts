import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class HostingStore {
  readonly db: DatabaseSync;
  private readonly key: Buffer;
  private pending: Promise<unknown> = Promise.resolve();

  private constructor(directory: string, key: Buffer) {
    this.key = key;
    this.db = new DatabaseSync(join(directory, "hosting.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS credentials (
        provider TEXT PRIMARY KEY, type TEXT NOT NULL, value BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
        scope TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pairings (
        hash TEXT PRIMARY KEY, scope TEXT NOT NULL, expires INTEGER NOT NULL
      );
    `);
  }

  static async open(directory: string) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = join(directory, "credentials.key");
    try {
      await writeFile(filename, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const key = await readFile(filename);
    if (key.length !== 32) throw new Error("凭据密钥文件无效。");
    return new HostingStore(directory, key);
  }

  encrypt(value: unknown, identity: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(identity));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
  }

  decrypt(value: Uint8Array, identity: string): unknown {
    const data = Buffer.from(value);
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      data.subarray(0, 12),
    );
    cipher.setAAD(Buffer.from(identity));
    cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(data.subarray(28)),
        cipher.final(),
      ]).toString("utf8"),
    );
  }

  transact<T>(run: () => Promise<T>) {
    const result = this.pending
      .catch(() => {})
      .then(async () => {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          const value = await run();
          this.db.exec("COMMIT");
          return value;
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
      });
    this.pending = result;
    return result;
  }

  async close() {
    await this.pending.catch(() => {});
    this.db.close();
  }
}
