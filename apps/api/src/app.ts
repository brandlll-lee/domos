import { MAX_FILE_BYTES } from "@domos/agent/attachments";
import type { Bots } from "@domos/agent/bots";
import type { Files } from "@domos/agent/files";
import type { Models } from "@earendil-works/pi-ai/models";
import { serveStatic } from "@hono/node-server/serve-static";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createRouter } from "./router.ts";

export function createApp(bots: Bots, models: Models, files: Files) {
  const app = new Hono();
  const handler = new RPCHandler(createRouter(bots, models, files));
  app.use(
    "/rpc/files/upload",
    bodyLimit({ maxSize: MAX_FILE_BYTES + 1024 * 1024 }),
  );
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
