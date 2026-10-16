import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { persistentCredentials } from "../src/credentials.ts";
import { serverOrigin } from "../src/instance.ts";
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
