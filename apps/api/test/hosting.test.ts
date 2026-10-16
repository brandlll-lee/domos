import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "@domos/agent/config";
import { Sessions } from "@domos/hosting/sessions";
import { HostingStore } from "@domos/hosting/store";
import { createModels } from "@earendil-works/pi-ai/models";
import { expect, onTestFinished, test } from "vitest";
import { hostingApp } from "../src/hosting/routes.ts";

test("hosting authenticates RPC, files, admin operations, origins and pairing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-auth-"));
  const store = await HostingStore.open(directory);
  const sessions = new Sessions(store);
  const hosted = hostingApp({
    config: parseConfig(
      { publicUrl: "https://domos.test", dataDir: directory },
      join(directory, "config.json"),
    ),
    sessions,
    models: createModels(),
    start: async () => {},
    forward: async (request) =>
      Response.json({ path: new URL(request.url).pathname }),
  });
  onTestFinished(async () => {
    hosted.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path: string, init: RequestInit = {}) =>
    hosted.app.request(`https://domos.test${path}`, init);
  expect((await request("/rpc/bots/list")).status).toBe(401);
  expect((await request("/files/1/test")).status).toBe(401);
  const pairing = sessions.pairing("client");
  const login = await request("/hosting/exchange", {
    method: "POST",
    headers: {
      Origin: "https://domos.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code: pairing.code, label: "Phone" }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  expect(login.headers.get("set-cookie")).toContain("HttpOnly");
  expect(login.headers.get("set-cookie")).toContain("Secure");
  expect(
    (await request("/rpc/bots/list", { headers: { Cookie: cookie } })).status,
  ).toBe(200);
  expect(
    (await request("/hosting/devices", { headers: { Cookie: cookie } })).status,
  ).toBe(403);
  expect(
    (
      await request("/rpc/computer/manage", {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://domos.test" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request("/rpc/bots/create", {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://evil.test" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request("/rpc/bots/create", {
        method: "POST",
        headers: { Cookie: cookie },
      })
    ).status,
  ).toBe(403);
  const owner = sessions.exchange(sessions.pairing("admin").code, "Owner");
  expect(
    (
      await request("/hosting/devices", {
        headers: { Authorization: `Bearer ${owner?.token}` },
      })
    ).status,
  ).toBe(200);
  const device = (await login.json()).device;
  sessions.revoke(device.id);
  expect(
    (await request("/files/1/test", { headers: { Cookie: cookie } })).status,
  ).toBe(401);
});
