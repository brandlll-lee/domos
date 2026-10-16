import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HostingStore } from "./store.ts";

export const sessionPolicy = {
  pairingMs: 5 * 60_000,
  sessionMs: 30 * 24 * 60 * 60_000,
  attempts: 10,
  attemptWindowMs: 60_000,
} as const;
export type Scope = "admin" | "client";
export type Device = {
  id: string;
  label: string;
  scope: Scope;
  created: number;
  expires: number;
};
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class Sessions {
  private readonly active = new Map<string, Set<AbortController>>();
  private attempts = 0;
  private window = 0;

  readonly store: HostingStore;
  readonly now: () => number;
  constructor(store: HostingStore, now = Date.now) {
    this.store = store;
    this.now = now;
  }

  list() {
    return this.store.db
      .prepare(
        "SELECT id,label,scope,created,expires FROM devices WHERE expires>? ORDER BY created",
      )
      .all(this.now()) as Device[];
  }

  pairing(scope: Scope) {
    const code = randomBytes(15).toString("base64url");
    const expires = this.now() + sessionPolicy.pairingMs;
    this.store.db
      .prepare("DELETE FROM pairings WHERE expires<=?")
      .run(this.now());
    this.store.db
      .prepare("INSERT INTO pairings VALUES (?,?,?)")
      .run(digest(code), scope, expires);
    return { code, expires };
  }

  async bootstrap(directory: string) {
    if (
      this.store.db.prepare("SELECT 1 FROM devices WHERE scope='admin'").get()
    )
      return;
    const filename = join(directory, "owner-code");
    try {
      const code = await readFile(filename, "utf8");
      if (
        this.store.db
          .prepare("SELECT 1 FROM pairings WHERE hash=? AND expires>?")
          .get(digest(code), this.now())
      )
        return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(filename, this.pairing("admin").code, { mode: 0o600 });
  }

  exchange(code: string, label: string) {
    const now = this.now();
    if (now - this.window >= sessionPolicy.attemptWindowMs) {
      this.attempts = 0;
      this.window = now;
    }
    if (++this.attempts > sessionPolicy.attempts)
      throw new Error("请稍后再试。");
    const row = this.store.db
      .prepare(
        "DELETE FROM pairings WHERE hash=? AND expires>? RETURNING scope",
      )
      .get(digest(code), now);
    if (!row) return undefined;
    const token = randomBytes(32).toString("base64url");
    const device: Device = {
      id: randomUUID(),
      label,
      scope: row.scope as Scope,
      created: now,
      expires: now + sessionPolicy.sessionMs,
    };
    this.store.db
      .prepare("INSERT INTO devices VALUES (?,?,?,?,?,?)")
      .run(device.id, digest(token), label, device.scope, now, device.expires);
    return { token, device };
  }

  authenticate(token: string) {
    return this.store.db
      .prepare(
        "SELECT id,label,scope,created,expires FROM devices WHERE hash=? AND expires>?",
      )
      .get(digest(token), this.now()) as Device | undefined;
  }

  revoke(id: string) {
    const device = this.store.db
      .prepare("SELECT scope FROM devices WHERE id=?")
      .get(id);
    if (
      device?.scope === "admin" &&
      this.list().filter((d) => d.scope === "admin").length === 1
    )
      throw new Error("请保留至少一台管理员设备。");
    this.store.db.prepare("DELETE FROM devices WHERE id=?").run(id);
    for (const controller of this.active.get(id) ?? []) controller.abort();
    this.active.delete(id);
  }

  track(device: Device) {
    const controller = new AbortController();
    const entries = this.active.get(device.id) ?? new Set();
    entries.add(controller);
    this.active.set(device.id, entries);
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(device.expires - this.now(), 2_147_483_647),
    );
    timer.unref();
    return {
      signal: controller.signal,
      release: () => {
        clearTimeout(timer);
        entries.delete(controller);
        if (!entries.size) this.active.delete(device.id);
      },
    };
  }

  async removeBootstrap(directory: string) {
    await unlink(join(directory, "owner-code")).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
