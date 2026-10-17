import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "@domos/agent/config";
import { Sessions } from "@domos/hosting/sessions";
import { HostingStore } from "@domos/hosting/store";
import { createModels } from "@earendil-works/pi-ai/models";
import { expect, onTestFinished, test } from "vitest";
import { hostingApp } from "../src/hosting/routes.ts";

test("managed desktop pairing requires its private installation credential", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-desktop-auth-"));
  const credentialFile = join(directory, "desktop-token");
  const credential = crypto.randomUUID();
  await writeFile(credentialFile, credential);
  const store = await HostingStore.open(directory);
  const sessions = new Sessions(store);
  const hosted = hostingApp({
    config: parseConfig(
      { dataDir: directory, desktopCredentialFile: credentialFile },
      join(directory, "config.json"),
    ),
    sessions,
    models: createModels(),
    forward: async () => Response.json({ ok: true }),
  });
  onTestFinished(async () => {
    hosted.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = (authorization: string) =>
    hosted.app.request("http://127.0.0.1:4310/hosting/desktop", {
      method: "POST",
      headers: { Authorization: authorization },
    });
  expect((await request("Bearer wrong")).status).toBe(401);
  const client = sessions.exchange(sessions.pairing("client").code, "Phone");
  expect((await request(`Bearer ${client?.token}`)).status).toBe(401);
  const response = await request(`Bearer ${credential}`);
  expect(response.status).toBe(200);
  const session = await response.json();
  expect(sessions.authenticate(session.token)?.scope).toBe("admin");
  expect(
    (
      await hosted.app.request("http://127.0.0.1:4310/hosting/desktop", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential}`,
          Origin: "https://other.test",
        },
      })
    ).status,
  ).toBe(403);
});

test("hosting authenticates RPC, files, admin operations, origins and pairing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-auth-"));
  const store = await HostingStore.open(directory);
  const sessions = new Sessions(store);
  let streamClosed = false;
  const hosted = hostingApp({
    config: parseConfig(
      { publicUrl: "https://domos.test", dataDir: directory },
      join(directory, "config.json"),
    ),
    sessions,
    models: createModels(),
    forward: async (request) => {
      if (new URL(request.url).pathname.endsWith("/watch"))
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("ready"));
            },
            cancel() {
              streamClosed = true;
            },
          }),
        );
      return Response.json({ path: new URL(request.url).pathname });
    },
  });
  onTestFinished(async () => {
    hosted.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path: string, init: RequestInit = {}) =>
    hosted.app.request(`https://domos.test${path}`, init);
  expect((await request("/rpc/bots/list")).status).toBe(401);
  expect(
    (
      await hosted.app.request("http://127.0.0.1/health", {
        headers: { Host: "127.0.0.1" },
      })
    ).status,
  ).toBe(200);
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
  for (const operation of [
    "manage",
    "add",
    "authorize",
    "default",
    "configure",
  ]) {
    expect(
      (
        await request(`/rpc/computer/${operation}`, {
          method: "POST",
          headers: { Cookie: cookie, Origin: "https://domos.test" },
        })
      ).status,
    ).toBe(403);
  }
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
  const stream = await request("/rpc/watch", { headers: { Cookie: cookie } });
  const reader = stream.body?.getReader();
  expect((await reader?.read())?.done).toBe(false);
  sessions.revoke(device.id);
  expect((await reader?.read())?.done).toBe(true);
  expect(streamClosed).toBe(true);
  expect(
    (await request("/files/1/test", { headers: { Cookie: cookie } })).status,
  ).toBe(401);
});
