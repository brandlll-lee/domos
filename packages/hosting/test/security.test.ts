import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, onTestFinished, test, vi } from "vitest";
import { persistentCredentials } from "../src/credentials.ts";
import { desktopSession } from "../src/desktop.ts";
import { connectionLink, serverOrigin } from "../src/instance.ts";
import { Sessions, sessionPolicy } from "../src/sessions.ts";
import { HostingStore } from "../src/store.ts";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "domos-hosting-"));
  const store = await HostingStore.open(directory);
  onTestFinished(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, store };
}

test("desktop identity adopts its current grant, rotates in place, and isolates installations", async () => {
  const { store, directory } = await fixture();
  let now = Date.now();
  const sessions = new Sessions(store, () => now);
  const owner = sessions.exchange(sessions.pairing("admin").code, "Domos 桌面");
  if (!owner) throw new Error("Owner required");
  const identity = {
    installationId: crypto.randomUUID(),
    currentToken: owner.token,
  };
  const adopted = await desktopSession(sessions, directory, identity);
  expect(sessions.list()).toHaveLength(1);
  expect(sessions.authenticate(adopted.token)?.id).toBe(owner.device.id);
  expect(
    await desktopSession(sessions, directory, {
      ...identity,
      currentToken: adopted.token,
    }),
  ).toEqual(adopted);
  const adoptedDevice = sessions.authenticate(adopted.token);
  if (!adoptedDevice) throw new Error("Desktop grant required");
  const tracked = sessions.track(adoptedDevice);
  now += 1000;
  const rotated = await desktopSession(sessions, directory, {
    installationId: identity.installationId,
  });
  expect(rotated.token).not.toBe(adopted.token);
  expect(sessions.authenticate(adopted.token)).toBeUndefined();
  expect(tracked.signal.aborted).toBe(true);
  tracked.release();
  expect(sessions.authenticate(rotated.token)).toMatchObject({
    id: owner.device.id,
    created: owner.device.created,
    installationId: identity.installationId,
  });
  const restarted = new Sessions(store, () => now);
  await desktopSession(restarted, directory, {
    installationId: identity.installationId,
    currentToken: rotated.token,
  });
  expect(restarted.list()).toHaveLength(1);
  await desktopSession(restarted, directory, {
    installationId: crypto.randomUUID(),
    currentToken: rotated.token,
  });
  expect(restarted.list()).toHaveLength(2);
  now += sessionPolicy.sessionMs;
  const renewed = await desktopSession(restarted, directory, {
    installationId: identity.installationId,
  });
  expect(restarted.authenticate(renewed.token)?.id).toBe(owner.device.id);
  expect(
    Number(store.db.prepare("SELECT COUNT(*) n FROM devices").get()?.n),
  ).toBe(2);
});

test("old grants survive schema migration and cleanup preserves current and later grants", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-device-upgrade-"));
  const old = new DatabaseSync(join(directory, "hosting.sqlite"));
  old.exec(
    "CREATE TABLE devices(id TEXT PRIMARY KEY,hash TEXT UNIQUE,label TEXT,scope TEXT,created INTEGER,expires INTEGER)",
  );
  old
    .prepare("INSERT INTO devices VALUES(?,?,?,?,?,?)")
    .run("old", "saved-hash", "Domos 桌面", "admin", 1, Date.now() + 86400_000);
  old.close();
  const store = await HostingStore.open(directory);
  onTestFinished(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const sessions = new Sessions(store);
  expect(sessions.list()[0]).toMatchObject({
    id: "old",
    installationId: null,
    lastSeen: null,
  });
  const owner = await desktopSession(sessions, directory, {
    installationId: crypto.randomUUID(),
  });
  const current = sessions.authenticate(owner.token);
  if (!current) throw new Error("Current grant required");
  const preview = sessions.list().filter((device) => device.id !== current.id);
  const later = sessions.exchange(sessions.pairing("admin").code, "Domos 桌面");
  if (!later) throw new Error("Later grant required");
  const removed = await sessions.revokeOthers(current.id, [
    ...preview.map((device) => device.id),
    current.id,
  ]);
  expect(removed).toEqual(["old"]);
  expect(sessions.authenticate(owner.token)?.id).toBe(current.id);
  expect(sessions.authenticate(later.token)?.id).toBe(later.device.id);
  expect(sessions.list()).toHaveLength(2);
});

test("pairing links retain the secret in the fragment and reject other URL credentials", () => {
  expect(
    connectionLink("https://domos.test/#pair=12345678901234567890"),
  ).toEqual({ origin: "https://domos.test", code: "12345678901234567890" });
  expect(connectionLink("127.0.0.1:4310").origin).toBe(
    "https://127.0.0.1:4310",
  );
  for (const value of [
    "https://user:secret@domos.test/#pair=12345678901234567890",
    "https://domos.test/?pair=secret",
    "https://domos.test/#pair=short",
    "http://domos.test/#pair=12345678901234567890",
  ])
    expect(() => connectionLink(value)).toThrow();
});

test("pairing is single use, scoped, bounded, and revocation closes active requests", async () => {
  const { store, directory } = await fixture();
  let now = Date.now();
  const sessions = new Sessions(store, () => now);
  await sessions.bootstrap(directory);
  const owner = sessions.exchange(
    await readFile(join(directory, "owner-code"), "utf8"),
    "Owner",
  );
  expect(owner?.device.scope).toBe("admin");
  const pair = sessions.pairing("client");
  const device = sessions.exchange(pair.code, "Phone");
  expect(device?.device.scope).toBe("client");
  expect(sessions.exchange(pair.code, "Replay")).toBeUndefined();
  expect(device).toBeDefined();
  if (!device) throw new Error("Pair required");
  const active = sessions.track(device.device);
  sessions.revoke(device.device.id);
  expect(active.signal.aborted).toBe(true);
  active.release();
  expect(sessions.authenticate(device.token)).toBeUndefined();
  expect(() => sessions.revoke(owner?.device.id ?? "")).toThrow("管理员");
  const expired = sessions.pairing("client");
  now += sessionPolicy.pairingMs;
  expect(sessions.exchange(expired.code, "Expired")).toBeUndefined();
  now += sessionPolicy.sessionMs;
  expect(sessions.authenticate(owner?.token ?? "")).toBeUndefined();
  await sessions.bootstrap(directory);
  expect(
    sessions.exchange(
      await readFile(join(directory, "owner-code"), "utf8"),
      "Recovered",
    )?.device.scope,
  ).toBe("admin");
});

test("active sessions expire at their recorded deadline", async () => {
  const { store } = await fixture();
  vi.useFakeTimers();
  try {
    const sessions = new Sessions(store);
    const device = sessions.exchange(sessions.pairing("admin").code, "Owner");
    if (!device) throw new Error("Device required");
    const active = sessions.track(device.device);
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(active.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(sessionPolicy.sessionMs - 2_147_483_647);
    expect(active.signal.aborted).toBe(true);
    active.release();
  } finally {
    vi.useRealTimers();
  }
});

test("provider credentials persist encrypted and concurrent updates see the committed state", async () => {
  const { store } = await fixture();
  const credentials = persistentCredentials(store);
  const key = crypto.randomUUID();
  await credentials.modify("sample", async () => ({ type: "api_key", key }));
  await Promise.all(
    Array.from({ length: 4 }, () =>
      credentials.modify("sample", async (current) => {
        if (current?.type !== "api_key") throw new Error("Credential required");
        return { ...current, key: `${current.key}x` };
      }),
    ),
  );
  expect(await credentials.read("sample")).toEqual({
    type: "api_key",
    key: `${key}xxxx`,
  });
  const row = store.db.prepare("SELECT value FROM credentials").get();
  expect(Buffer.from(row?.value as Uint8Array).includes(Buffer.from(key))).toBe(
    false,
  );
  expect(await credentials.list()).toEqual([
    { providerId: "sample", type: "api_key" },
  ]);
  const stored = row?.value as Uint8Array;
  expect(() => store.decrypt(stored, "other")).toThrow();
  await credentials.delete("sample");
  expect(await credentials.read("sample")).toBeUndefined();
});

test("instance addresses preserve a single secure origin", () => {
  expect(serverOrigin("example.test/path")).toBe("https://example.test");
  expect(serverOrigin("http://127.0.0.1:4310")).toBe("http://127.0.0.1:4310");
  expect(() => serverOrigin("http://192.168.1.2:4310")).toThrow("HTTPS");
  expect(() => serverOrigin("https://user:pass@example.test")).toThrow();
});

test("device pages retain current authorization and distinct same-name devices", async () => {
  const { store } = await fixture();
  let now = Date.now();
  const sessions = new Sessions(store, () => now);
  const grants = Array.from({ length: 24 }, () => {
    now += sessionPolicy.attemptWindowMs;
    return sessions.exchange(sessions.pairing("admin").code, "Domos 桌面");
  });
  const current = grants[0];
  if (!current) throw new Error("Current grant required");
  const first = sessions.page(current.device.id);
  const second = sessions.page(current.device.id, 2);
  const third = sessions.page(current.device.id, 3);
  expect(first.items[0]?.id).toBe(current.device.id);
  expect(first.items).toHaveLength(10);
  expect(second.items).toHaveLength(10);
  expect(third.items).toHaveLength(4);
  expect(
    new Set(
      [...first.items, ...second.items, ...third.items].map((item) => item.id),
    ).size,
  ).toBe(24);
  const revoked = second.items[0];
  if (!revoked) throw new Error("Device required");
  sessions.revoke(revoked.id);
  expect(sessions.page(current.device.id).total).toBe(23);
  expect(sessions.authenticate(current.token)?.id).toBe(current.device.id);
});
