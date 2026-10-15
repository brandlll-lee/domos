import type { Conversation } from "@earendil-works/pi-durable";
import { serveStatic } from "@hono/node-server/serve-static";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { createRouter } from "./router.ts";

export function createApp(conversation: Conversation) {
  const app = new Hono();
  const handler = new RPCHandler(createRouter(conversation));
  app.use("/rpc/*", async (c, next) => {
    const { matched, response } = await handler.handle(c.req.raw, {
      prefix: "/rpc",
    });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });
  app.get("/health", (c) => c.json({ ok: true }));
  app.use("/*", serveStatic({ root: "./apps/web/dist" }));
  app.onError(() => new Response("服务暂时不可用。", { status: 500 }));
  return app;
}
