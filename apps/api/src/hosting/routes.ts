import type { RuntimeConfig } from "@domos/agent/config";
import type { Sessions } from "@domos/hosting/sessions";
import type { Models } from "@earendil-works/pi-ai";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { ModelLogins } from "./login.ts";
import {
  administrator,
  authenticate,
  type HostingEnv,
  originGuard,
  sessionCookie,
} from "./security.ts";

export function hostingApp(options: {
  config: RuntimeConfig;
  sessions: Sessions;
  models: Models;
  forward: (request: Request) => Promise<Response>;
}) {
  const { config, sessions, models } = options;
  const publicUrl = config.publicUrl ?? `http://${config.host}:${config.port}`;
  const logins = new ModelLogins(models);
  const app = new Hono<HostingEnv>();
  app.get("/health", (c) => c.json({ ok: true }));
  app.use("*", originGuard(publicUrl));
  app.get("/hosting/info", (c) =>
    c.json({
      product: "domos",
      version: "1",
    }),
  );
  app.use("/hosting/*", bodyLimit({ maxSize: 64 * 1024 }));
  app.use("/hosting/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.post("/hosting/exchange", async (c) => {
    const input = z
      .object({
        code: z.string().min(1).max(80),
        label: z.string().trim().min(1).max(80),
      })
      .parse(await c.req.json());
    const result = sessions.exchange(input.code, input.label);
    if (!result) return c.json({ error: "配对码无效或已过期。" }, 401);
    sessionCookie(
      c,
      result.token,
      result.device.expires,
      new URL(publicUrl).protocol === "https:",
    );
    if (result.device.scope === "admin")
      await sessions.removeBootstrap(config.dataDir);
    return c.json({ device: result.device });
  });
  app.use("/hosting/*", authenticate(sessions));
  app.get("/hosting/session", (c) => c.json({ device: c.get("device") }));
  app.post("/hosting/logout", async (c) => {
    logins.cancel(c.get("device").id);
    sessions.logout(c.get("device").id);
    await sessions.bootstrap(config.dataDir);
    sessionCookie(c, "", 0, new URL(publicUrl).protocol === "https:");
    return c.json({ ok: true });
  });
  app.use("/hosting/*", administrator);
  app.get("/hosting/devices", (c) => c.json(sessions.list()));
  app.post("/hosting/pairing", async (c) => {
    const { scope } = z
      .object({ scope: z.enum(["admin", "client"]) })
      .parse(await c.req.json());
    return c.json(sessions.pairing(scope));
  });
  app.delete("/hosting/devices/:id", (c) => {
    sessions.revoke(c.req.param("id"));
    logins.cancel(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get("/hosting/models", async (c) =>
    c.json({
      providers: await Promise.all(
        models.getProviders().map(async (provider) => ({
          id: provider.id,
          name: provider.name,
          methods: [
            ...(provider.auth.apiKey?.login
              ? [{ type: "api_key", name: provider.auth.apiKey.name }]
              : []),
            ...(provider.auth.oauth
              ? [{ type: "oauth", name: provider.auth.oauth.name }]
              : []),
          ],
          configured: Boolean(await models.checkAuth(provider.id)),
        })),
      ),
      models: (await models.getAvailable()).map((model) => ({
        provider: model.provider,
        modelId: model.id,
        name: model.name,
      })),
    }),
  );
  app.post("/hosting/login", async (c) => {
    const input = z
      .object({ provider: z.string(), type: z.enum(["api_key", "oauth"]) })
      .parse(await c.req.json());
    return c.json(logins.start(c.get("device").id, input.provider, input.type));
  });
  app.get("/hosting/login/:id", (c) =>
    c.json(logins.status(c.req.param("id"), c.get("device").id)),
  );
  app.post("/hosting/login/:id", async (c) => {
    const input = z
      .object({ promptId: z.uuid(), value: z.string().max(32_000) })
      .parse(await c.req.json());
    const flow = logins.get(c.req.param("id"), c.get("device").id);
    if (flow.prompt?.id !== input.promptId || !flow.answer)
      return c.json({ error: "输入请求已更新。" }, 409);
    flow.answer(input.value);
    return c.json({ ok: true });
  });
  app.delete("/hosting/login/:id", (c) => {
    logins.get(c.req.param("id"), c.get("device").id);
    logins.cancel(c.get("device").id, c.req.param("id"));
    return c.json({ ok: true });
  });
  app.delete("/hosting/login", (c) => {
    logins.cancel(c.get("device").id);
    return c.json({ ok: true });
  });
  app.delete("/hosting/models/:provider", async (c) => {
    await models.logout(c.req.param("provider"));
    return c.json({ ok: true });
  });
  const protectedApp = new Hono<HostingEnv>();
  protectedApp.use("*", authenticate(sessions));
  protectedApp.use("/computer/manage", administrator);
  protectedApp.use("/computer/add", administrator);
  protectedApp.use("/computer/authorize", administrator);
  protectedApp.use("/computer/default", administrator);
  protectedApp.use("/computer/configure", administrator);
  protectedApp.all("*", async (c) => {
    const tracked = sessions.track(c.get("device"));
    const signal = AbortSignal.any([c.req.raw.signal, tracked.signal]);
    try {
      const response = await options.forward(
        new Request(c.req.raw, { signal }),
      );
      if (!response.body) {
        tracked.release();
        return response;
      }
      const reader = response.body.getReader();
      signal.addEventListener(
        "abort",
        () => void reader.cancel(signal.reason).catch(() => {}),
        { once: true },
      );
      if (signal.aborted) await reader.cancel(signal.reason);
      const body = new ReadableStream({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              tracked.release();
              controller.close();
            } else controller.enqueue(next.value);
          } catch (error) {
            tracked.release();
            controller.error(error);
          }
        },
        async cancel(reason) {
          tracked.release();
          await reader.cancel(reason);
        },
      });
      const headers = new Headers(response.headers);
      if (new URL(c.req.url).pathname.startsWith("/files/"))
        headers.set("Cache-Control", "private, no-store");
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      tracked.release();
      throw error;
    }
  });
  app.route("/rpc", protectedApp);
  app.route("/files", protectedApp);
  app.use("/*", serveStatic({ root: config.staticDir }));
  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof z.ZodError
            ? "输入格式无效。"
            : "操作未完成。请检查设置后重试。",
      },
      400,
    ),
  );
  return { app, close: () => logins.close() };
}
