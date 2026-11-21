import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "@domos/agent/config";
import { Sessions } from "@domos/hosting/sessions";
import { HostingStore } from "@domos/hosting/store";
import { createModels } from "@earendil-works/pi-ai/models";
import { expect, onTestFinished, test, vi } from "vitest";
import { hostingApp } from "../src/hosting/routes.ts";

test("managed desktop pairing requires its private installation credential", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-desktop-auth-"));
  const credentialFile = join(directory, "desktop-token");
  const credential = crypto.randomUUID();
  await writeFile(credentialFile, credential);
  const store = await HostingStore.open(directory);
  const sessions = new Sessions(store);
  let held = false;
  const hosted = hostingApp({
    computerId: "test-computer",
    config: parseConfig(
      { dataDir: directory, desktopCredentialFile: credentialFile },
      join(directory, "config.json"),
    ),
    sessions,
    models: createModels(),
    maintenance: async (value) => {
      if (value !== undefined) held = value;
      return held;
    },
    forward: async () => Response.json({ ok: true }),
  });
  onTestFinished(async () => {
    hosted.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = (authorization: string, currentToken?: string) =>
    hosted.app.request("http://127.0.0.1:4310/hosting/desktop", {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        installationId: "278e1234-a89b-4b40-8012-299d34382aa2",
        currentToken,
      }),
    });
  expect((await request("Bearer wrong")).status).toBe(401);
  const client = sessions.exchange(sessions.pairing("client").code, "Phone");
  expect((await request(`Bearer ${client?.token}`)).status).toBe(401);
  const response = await request(`Bearer ${credential}`);
  expect(response.status).toBe(200);
  const session = await response.json();
  expect(sessions.authenticate(session.token)?.scope).toBe("admin");
  expect((await request(`Bearer ${credential}`, session.token)).status).toBe(
    200,
  );
  expect(
    sessions.list().filter((device) => device.scope === "admin"),
  ).toHaveLength(1);
  expect(
    (
      await hosted.app.request("http://127.0.0.1:4310/hosting/desktop", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
  ).toBe(400);
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
  const maintenance = (value: boolean, token: string = credential) =>
    hosted.app.request("http://127.0.0.1:4310/hosting/desktop", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maintenance: value }),
    });
  if (!client) throw new Error("Client session required");
  expect((await maintenance(true, client.token)).status).toBe(401);
  expect((await maintenance(true)).status).toBe(200);
  expect(
    (
      await hosted.app.request("http://127.0.0.1:4310/rpc/bots/list", {
        headers: { Authorization: `Bearer ${session.token}` },
      })
    ).status,
  ).toBe(503);
  expect((await maintenance(false)).status).toBe(200);
  expect(
    (
      await hosted.app.request("http://127.0.0.1:4310/rpc/bots/list", {
        headers: { Authorization: `Bearer ${session.token}` },
      })
    ).status,
  ).toBe(200);
});

test("connection checks, origin-specific cookies and explicit revocation share server authorization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-pairing-boundary-"));
  const store = await HostingStore.open(directory);
  const sessions = new Sessions(store);
  const config = parseConfig(
    { publicUrl: "https://domos.test", dataDir: directory },
    join(directory, "config.json"),
  );
  const hosted = hostingApp({
    config,
    sessions,
    computerId: "computer-a",
    models: createModels(),
    forward: async () => Response.json({ ok: true }),
  });
  onTestFinished(async () => {
    vi.restoreAllMocks();
    hosted.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const owner = sessions.exchange(sessions.pairing("admin").code, "Owner");
  if (!owner) throw new Error("Owner required");
  const headers = {
    Authorization: `Bearer ${owner.token}`,
    Origin: "https://domos.test",
    "Content-Type": "application/json",
  };
  const request = (path: string, init: RequestInit = {}) =>
    hosted.app.request(`https://domos.test/hosting/${path}`, {
      ...init,
      headers: { ...headers, ...init.headers },
    });
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      product: "domos",
      version: "1",
      computerId: "computer-b",
    }),
  );
  expect((await (await request("connection")).json()).state).toBe("error");
  expect(
    (
      await request("pairing", {
        method: "POST",
        body: JSON.stringify({ scope: "client" }),
      })
    ).status,
  ).toBe(409);
  fetcher.mockRejectedValueOnce(new Error("certificate has expired"));
  expect((await (await request("connection")).json()).error).toContain(
    "certificate has expired",
  );
  fetcher.mockImplementation(async () =>
    Response.json({ product: "domos", version: "1", computerId: "computer-a" }),
  );
  const pair = await (
    await request("pairing", {
      method: "POST",
      body: JSON.stringify({ scope: "client" }),
    })
  ).json();
  expect(new URL(pair.url).hash).toBe(`#pair=${pair.code}`);
  expect(new URL(pair.url).search).toBe("");
  const phone = sessions.exchange(pair.code, "Phone");
  if (!phone) throw new Error("Phone required");
  const tracked = sessions.track(phone.device);
  const preview = await (await request("devices/revocation")).json();
  const later = sessions.exchange(sessions.pairing("client").code, "Later");
  if (!later) throw new Error("Later grant required");
  const removed = await request("devices/revocation", {
    method: "POST",
    body: JSON.stringify({
      ids: [
        ...preview.items.map((item: { id: string }) => item.id),
        owner.device.id,
      ],
    }),
  });
  expect(removed.status).toBe(200);
  expect(tracked.signal.aborted).toBe(true);
  tracked.release();
  expect(sessions.authenticate(phone.token)).toBeUndefined();
  expect(sessions.authenticate(later.token)).toBeDefined();
  expect(sessions.authenticate(owner.token)).toBeDefined();
  expect(
    (
      await request("devices/revocation", {
        headers: { Authorization: `Bearer ${later.token}` },
      })
    ).status,
  ).toBe(403);
  for (const origin of ["http://127.0.0.1:4310", "https://domos.test"]) {
    const code = sessions.pairing("client").code;
    const response = await hosted.app.request(`${origin}/hosting/exchange`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ code, label: "Browser" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")?.includes("Secure")).toBe(
      origin.startsWith("https:"),
    );
  }
  expect(
    (
      await hosted.app.request("http://127.0.0.1:4310/hosting/session", {
        headers: { Origin: "https://domos.test" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request("exchange", {
        method: "POST",
        body: JSON.stringify({
          code: sessions.pairing("client").code,
          label: "Forged",
          installationId: crypto.randomUUID(),
        }),
      })
    ).status,
  ).toBe(400);
  const local = (path: string, body?: object) =>
    hosted.app.request(`http://127.0.0.1:4310/hosting/${path}`, {
      method: body ? "POST" : "GET",
      headers: { ...headers, Origin: "http://127.0.0.1:4310" },
      body: body ? JSON.stringify(body) : undefined,
    });
  expect(
    (
      await request("connection", {
        method: "POST",
        headers: { Authorization: `Bearer ${later.token}` },
        body: JSON.stringify({ mode: "off" }),
      })
    ).status,
  ).toBe(403);
  expect(
    (await local("connection", { mode: "https", url: "https://next.test" }))
      .status,
  ).toBe(200);
  expect((await request("connection")).status).toBe(403);
  expect(
    (
      await hosted.app.request("https://next.test/hosting/session", {
        headers: {
          Authorization: `Bearer ${owner.token}`,
          Origin: "https://next.test",
        },
      })
    ).status,
  ).toBe(200);
  expect((await local("session")).status).toBe(200);
  expect((await local("connection", { mode: "off" })).status).toBe(200);
  expect((await (await local("connection")).json()).state).toBe("local");
  expect((await local("pairing", { scope: "client" })).status).toBe(409);
});

test("hosting authenticates RPC, files, admin operations, origins and pairing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-auth-"));
  const store = await HostingStore.open(directory);
  const sessions = new Sessions(store);
  let streamClosed = false;
  const hosted = hostingApp({
    computerId: "test-computer",
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
  expect((await request("/usage/export.csv")).status).toBe(401);
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
    (await request("/usage/export.csv", { headers: { Cookie: cookie } }))
      .status,
  ).toBe(200);
  expect(
    (await request("/hosting/devices", { headers: { Cookie: cookie } })).status,
  ).toBe(403);
  expect(
    (
      await request("/rpc/models/setVisibility", {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://domos.test" },
      })
    ).status,
  ).toBe(403);
  expect(
    (await request("/rpc/models/visibility", { headers: { Cookie: cookie } }))
      .status,
  ).toBe(200);
  for (const operation of [
    "manage",
    "add",
    "authorize",
    "default",
    "rename",
    "directory",
    "directories",
    "prepare",
    "assign",
    "configure",
    "browserMode",
    "approval",
    "assistantKey",
    "assistantConfigure",
    "assistantTest",
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
  for (const operation of ["save", "test", "preview"]) {
    expect(
      (
        await request(`/rpc/images/${operation}`, {
          method: "POST",
          headers: { Cookie: cookie, Origin: "https://domos.test" },
        })
      ).status,
    ).toBe(403);
  }
  for (const operation of [
    "configure",
    "inspect",
    "install",
    "login",
    "answerLogin",
  ]) {
    expect(
      (
        await request(`/rpc/engines/${operation}`, {
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

test("HTML entry points use fresh resources after an update", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-web-entry-"));
  const store = await HostingStore.open(directory);
  const hosted = hostingApp({
    computerId: "test-computer",
    config: parseConfig(
      { dataDir: directory, staticDir: directory },
      join(directory, "config.json"),
    ),
    sessions: new Sessions(store),
    models: createModels(),
    forward: async () => Response.json({ ok: true }),
  });
  onTestFinished(async () => {
    hosted.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  for (const version of ["first", "second"]) {
    await writeFile(
      join(directory, "index.html"),
      `<script src="/assets/${version}.js"></script>`,
    );
    for (const path of ["/", "/index.html"]) {
      const response = await hosted.app.request(`http://127.0.0.1:4310${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toContain(`/assets/${version}.js`);
    }
  }
  await writeFile(join(directory, "app.js"), "export {};");
  expect(
    (await hosted.app.request("http://127.0.0.1:4310/app.js")).headers.get(
      "cache-control",
    ),
  ).not.toBe("no-store");
});
