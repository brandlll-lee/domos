import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { MAX_FILE_BYTES } from "@domos/agent/attachments";
import type { Bots } from "@domos/agent/bots";
import type { Computers } from "@domos/agent/computer/catalog";
import type { Files } from "@domos/agent/files";
import type { McpConnections } from "@domos/agent/mcp";
import type { Runtime } from "@domos/agent/runtime";
import type { BotWork } from "@domos/agent/work";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import { serveStatic } from "@hono/node-server/serve-static";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { botConversation } from "./conversation.ts";
import { createRouter } from "./router.ts";

export function createApp(
  bots: Bots,
  models: Models,
  files: Files,
  work: BotWork,
  computer?: Computers,
  staticDir = fileURLToPath(new URL("../../web/dist", import.meta.url)),
  engines?: Runtime,
  mcp?: McpConnections,
  mcpCallback?: string,
) {
  const app = new Hono();
  const handler = new RPCHandler(
    createRouter(
      bots,
      models,
      files,
      work,
      computer,
      engines,
      mcp,
      mcpCallback,
    ),
  );
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
  app.get("/mcp/oauth/callback", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (!mcp || !state || !code)
      return c.text("授权未完成。请返回 Domos 重试。", 400);
    try {
      await mcp.complete(state, code, BACKGROUND_CONTEXT);
      return c.text("授权已完成。请返回 Domos 刷新连接。");
    } catch {
      return c.text("授权失败或已取消。请返回 Domos 重试。", 400);
    }
  });
  app.put("/files/:botId/upload", async (c) => {
    const input = z
      .object({
        botId: z.coerce.number().int().nonnegative(),
        name: z.string().min(1).max(255),
        requestId: z.uuid(),
      })
      .safeParse({
        botId: c.req.param("botId"),
        name: c.req.query("name"),
        requestId: c.req.query("requestId"),
      });
    if (!input.success || !c.req.raw.body) return c.text("上传参数无效。", 400);
    await botConversation(bots, input.data.botId);
    if (Number(c.req.header("Content-Length")) > MAX_FILE_BYTES)
      return c.text("文件大小超过 100 MiB。", 413);
    const context = withAbortSignal(c.req.raw.signal, BACKGROUND_CONTEXT);
    const owner = await bots.owner(input.data.botId, context);
    try {
      const upload = () =>
        files.exclusive(owner, () =>
          files.uploadStream(
            owner,
            input.data.name,
            Readable.fromWeb(
              c.req.raw
                .body as import("node:stream/web").ReadableStream<Uint8Array>,
            ),
            context,
            input.data.requestId,
          ),
        );
      const file = await (computer
        ? computer.transfer(owner, upload, context)
        : upload());
      if (context.abortSignal?.aborted) {
        await files.discard(owner, file.id);
        context.abortSignal?.throwIfAborted();
      }
      return c.json(file);
    } catch (error) {
      return c.text(
        error instanceof Error ? error.message : "文件上传失败。",
        400,
      );
    }
  });
  app.get("/files/:botId/:id/preview", async (c) => {
    const botId = Number(c.req.param("botId"));
    if (
      !Number.isSafeInteger(botId) ||
      !(await bots.conversation(botId, BACKGROUND_CONTEXT))
    )
      return c.notFound();
    c.header("Cache-Control", "private, no-store");
    try {
      const owner = await bots.owner(botId, BACKGROUND_CONTEXT);
      const file = await files
        .metadata(owner, c.req.param("id"))
        .catch(() => null);
      if (!file) return c.notFound();
      const result = await files.previews.read(
        file,
        join(files.directory(owner, file.id), "content"),
        c.req.query("sheet"),
        c.req.raw.signal,
      );
      if (result.kind === "pdf") {
        if (c.req.query("format") === "pdf")
          return streamResponse(
            result.path,
            (await stat(result.path)).size,
            {
              "Content-Type": "application/pdf",
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
            c.req.header("Range"),
          );
        return c.json({ kind: "pdf", notice: result.notice });
      }
      return c.json(result);
    } catch (error) {
      return c.text(
        error instanceof Error ? error.message : "无法生成预览。",
        422,
      );
    }
  });
  app.get("/files/:botId/:id", async (c) => {
    const botId = Number(c.req.param("botId"));
    if (
      !Number.isSafeInteger(botId) ||
      !(await bots.conversation(botId, BACKGROUND_CONTEXT))
    )
      return c.notFound();
    try {
      const owner = await bots.owner(botId, BACKGROUND_CONTEXT);
      const file = await files.metadata(owner, c.req.param("id"));
      const download = c.req.query("download") === "1";
      if (
        !download &&
        !/^(image\/(?!svg)|audio\/|video\/|application\/pdf$)/.test(
          file.mimeType ?? "",
        )
      )
        return c.notFound();
      const headers: Record<string, string> = {
        "Content-Type": file.mimeType ?? "application/octet-stream",
        "Content-Disposition": download
          ? `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`
          : "inline",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=31536000, immutable",
      };
      return streamResponse(
        join(files.directory(owner, file.id), "content"),
        file.size,
        headers,
        c.req.header("Range"),
      );
    } catch {
      return c.notFound();
    }
  });
  app.use(
    "/*",
    async (c, next) => {
      await next();
      if (c.res.headers.get("Content-Type")?.startsWith("text/html"))
        c.header("Cache-Control", "no-store");
    },
    serveStatic({ root: staticDir }),
  );
  app.onError(() => new Response("服务暂时不可用。", { status: 500 }));
  return app;
}

function streamResponse(
  path: string,
  size: number,
  headers: Record<string, string>,
  requested?: string,
) {
  headers["Accept-Ranges"] = "bytes";
  let range: { start: number; end: number } | undefined;
  if (requested) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(requested);
    const start = match?.[1]
      ? Number(match[1])
      : Math.max(0, size - Number(match?.[2]));
    const end =
      match?.[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (
      !match ||
      (!match[1] && !match[2]) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end ||
      start >= size
    )
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    range = { start, end };
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(
    range ? range.end - range.start + 1 : size,
  );
  const body = Readable.toWeb(
    createReadStream(path, range),
  ) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}
