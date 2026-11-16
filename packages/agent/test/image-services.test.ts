import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import sharp from "sharp";
import { expect, onTestFinished, test, vi } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import {
  prepareImage,
  removeBackground,
} from "../src/harness/image-processing.mjs";
import { imageBaseUrl } from "../src/harness/image-service.mjs";
import { WorkProcess } from "../src/harness/process.ts";
import { productCatalog } from "../src/harness/product-tools.ts";
import type { EngineRuntime } from "../src/harness/task-types.ts";
import { ImageServices, imageExtension } from "../src/image-services.ts";
import { context, setup } from "./fixtures/work.ts";

const pixels = (width = 24, frames = 2) => {
  const data = Buffer.alloc(width * width * frames * 4);
  for (let f = 0; f < frames; f++)
    for (let y = 0; y < width; y++)
      for (let x = 0; x < width; x++) {
        const foreground = x >= 6 + f && x < 18 + f && y >= 6 && y < 18;
        data.set(
          foreground ? [240, 200, 0, 255] : [0, 0, 255, 255],
          ((f * width + y) * width + x) * 4,
        );
      }
  return data;
};

test("colour-key processing preserves enclosed same-colour details", () => {
  const data = pixels(24, 1);
  const centre = (12 * 24 + 12) * 4;
  data.set([0, 0, 255, 255], centre);
  removeBackground(data, 24, 24, [0, 0, 255]);
  expect(data[3]).toBe(0);
  expect([...data.subarray(centre, centre + 4)]).toEqual([0, 0, 255, 255]);
  expect(data[(8 * 24 + 8) * 4 + 3]).toBe(255);
  expect(() => imageBaseUrl("http://remote.example/v1")).toThrow("HTTPS");
  expect(() => imageBaseUrl("https://user:password@example.org/v1")).toThrow();
  expect(imageBaseUrl("http://127.0.0.1:3210/v1/")).toBe(
    "http://127.0.0.1:3210/v1",
  );
});

test("work process preserves animated transparency, references and paid request receipts", async () => {
  // Windows cannot delete fixtures while libvips retains decoded file handles.
  sharp.cache(false);
  const directory = await mkdtemp(join(tmpdir(), "domos-image-worker-"));
  const gif = await sharp(pixels(), {
    raw: { width: 24, height: 48, channels: 4, pageHeight: 24 },
  })
    .gif({ delay: [100, 100], loop: 0 })
    .toBuffer();
  const cancelledStarted = Promise.withResolvers<void>();
  let calls = 0;
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const server = createServer(async (request, response) => {
    if (request.url === "/v1/models") {
      response.end(
        JSON.stringify({ data: [{ id: "gpt-image-2.6-sunburst" }] }),
      );
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      path: request.url ?? "",
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    calls++;
    if (requests.at(-1)?.body.prompt === "cancelled") {
      cancelledStarted.resolve();
      return;
    }
    if (requests.at(-1)?.body.prompt === "uncertain") {
      response.destroy();
      return;
    }
    response.end(
      JSON.stringify({ data: [{ b64_json: gif.toString("base64") }] }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("server address");
  const worker = new WorkProcess(
    [
      process.execPath,
      fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
    ],
    { cwd: directory, home: directory },
    [],
    async () => ({ content: [] }),
  );
  onTestFinished(async () => {
    server.closeAllConnections();
    server.close();
    await worker.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }, 30000);
  await worker.ready;
  const base = {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    key: "test-credential",
  };
  expect(await worker.mcp({ ...base, action: "image_test" })).toEqual({
    models: ["gpt-image-2.6-sunburst"],
    gifVerified: false,
  });
  const input = {
    ...base,
    action: "image_generate",
    requestId: "stable-call",
    params: {
      model: "gpt-image-2.6-sunburst",
      prompt: "wave",
      format: "gif",
      count: 1,
      transparent: true,
      frames: 2,
      frameDurationMs: 100,
      references: ["data:image/png;base64,dGVzdA=="],
    },
  };
  type Result = {
    files: {
      path: string;
      original: string;
      cover: string;
      frames: number;
      delay: number[];
    }[];
  };
  const generated = await worker.mcp<Result>(input);
  const file = generated.files[0];
  if (!file) throw new Error("Generated image missing");
  expect(file).toMatchObject({ frames: 2, delay: [100, 100] });
  expect(await readFile(file.original)).toEqual(gif);
  const output = sharp(file.path, { animated: true });
  expect(await output.metadata()).toMatchObject({
    format: "webp",
    pages: 2,
    delay: [100, 100],
    hasAlpha: true,
  });
  const data = await output.ensureAlpha().raw().toBuffer();
  expect(data[3]).toBe(0);
  expect(data[(12 * 24 + 12) * 4 + 3]).toBe(255);
  expect(await sharp(file.cover).metadata()).toMatchObject({ format: "png" });
  expect((await worker.mcp<Result>(input)).files).toEqual(generated.files);
  expect(calls).toBe(1);
  expect(requests[0]).toMatchObject({
    path: "/v1/images/edits",
    body: {
      images: [{ image_url: "data:image/png;base64,dGVzdA==" }],
      frame_count: 2,
      frame_duration_ms: 100,
    },
  });
  await expect(
    worker.mcp({ ...input, params: { ...input.params, prompt: "changed" } }),
  ).rejects.toThrow("请求标识");
  const uncertain = {
    ...input,
    requestId: "uncertain-call",
    params: { ...input.params, prompt: "uncertain", transparent: false },
  };
  await expect(worker.mcp(uncertain)).rejects.toThrow();
  const after = calls;
  await expect(worker.mcp(uncertain)).rejects.toThrow("结果未知");
  expect(calls).toBe(after);
  const cancelled = {
    ...uncertain,
    requestId: "cancelled-call",
    params: { ...uncertain.params, prompt: "cancelled" },
  };
  const controller = new AbortController();
  const pending = worker.mcp(cancelled, controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  await cancelledStarted.promise;
  await expect(worker.mcp({ ...base, action: "image_test" })).rejects.toThrow(
    "已有图像操作",
  );
  controller.abort(new Error("Stopped"));
  await rejected;
  const afterCancel = calls;
  await expect(worker.mcp(cancelled)).rejects.toThrow("结果未知");
  expect(calls).toBe(afterCancel);
  const local = { ...input, requestId: "local-processing" };
  const blockedOutput = join(
    directory,
    ".domos-generated",
    createHash("sha256").update(local.requestId).digest("hex"),
    "0.webp",
  );
  await mkdir(blockedOutput, { recursive: true });
  await expect(worker.mcp(local)).rejects.toThrow();
  const afterLocal = calls;
  await rm(blockedOutput, { recursive: true });
  expect((await worker.mcp<Result>(local)).files[0]?.frames).toBe(2);
  expect(calls).toBe(afterLocal);
  const invalid = join(directory, "invalid");
  await writeFile(invalid, "not an image");
  await expect(prepareImage(invalid)).rejects.toThrow("未返回支持");
}, 30000);

test("image configuration scopes encrypted credentials and rejects stale saves before changing a key", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  onTestFinished(() => runtime.harness.close(context));
  let computerId = "first";
  const records = new Map<string, Credential>();
  const credentials: CredentialStore = {
    read: async (id) => records.get(id),
    list: async () => [],
    delete: async (id) => {
      records.delete(id);
    },
    modify: async (id, update) => {
      const value = await update(records.get(id));
      if (value) records.set(id, value);
      return value;
    },
  };
  const mcp = vi.fn(async () => ({
    models: ["gpt-image-2.6-flare"],
    gifVerified: false,
  }));
  const computers = {
    binding: async () => ({ computer: { id: computerId, authorized: true } }),
    mcp,
  } as unknown as Computers;
  const service = new ImageServices(
    runtime.harness,
    computers,
    runtime.files,
    credentials,
  );
  const botId = runtime.conversation.id;
  const initial = await service.state(botId, context);
  expect(initial.baseUrl).toBe("https://api.openai.com/v1");
  const saved = await service.save(
    botId,
    {
      ...initial,
      baseUrl: "https://example.com/v1",
      apiKey: "private-test-key",
    },
    context,
  );
  expect(saved.configured).toBe(true);
  expect((await service.state(botId, context)).baseUrl).toBe(
    "https://example.com/v1",
  );
  expect(JSON.stringify(saved)).not.toContain("private-test-key");
  await expect(
    service.save(botId, { ...initial, apiKey: "wrong-stale-key" }, context),
  ).rejects.toThrow();
  expect(records.get("domos-image:first")).toEqual({
    type: "api_key",
    key: "private-test-key",
  });
  expect(await service.test(botId, context)).toMatchObject({
    gifVerified: false,
  });
  computerId = "second";
  expect((await service.state(botId, context)).configured).toBe(false);
  await expect(
    service.save(botId, { ...saved, apiKey: "changed" }, context),
  ).rejects.toThrow("工作电脑已改变");
  expect(mcp).toHaveBeenCalledTimes(1);
});

test("shared identity tool retains instructions, publishes media and cannot replay over a later change", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  onTestFinished(() => runtime.harness.close(context));
  const botId = runtime.conversation.id;
  const extension = imageExtension(
    () => {
      throw new Error("unused");
    },
    () => runtime.bots,
  );
  const catalog = await productCatalog(
    {
      conversationId: botId,
      registry: {
        tools: () => extension.tools.map((tool) => ({ extension, tool })),
      },
      agent: async () => ({
        callable: [{ name: "image_generate" }, { name: "bot_update" }],
      }),
      snapshot: runtime.harness.snapshot.bind(runtime.harness),
    } as unknown as EngineRuntime,
    context,
  );
  expect(catalog.map((item) => item.name)).toEqual(
    expect.arrayContaining(["image_generate", "bot_update"]),
  );
  expect(
    JSON.stringify(
      catalog.find((item) => item.name === "image_generate")?.inputSchema,
    ),
  ).toContain("gpt-image-2.6-sunburst");
  const other = await runtime.bots.create(
    { name: "Other", requestId: crypto.randomUUID() },
    context,
  );
  const bytes = await sharp(pixels(24, 1), {
    raw: { width: 24, height: 24, channels: 4 },
  })
    .png()
    .toBuffer();
  const file = await runtime.files.upload(botId, "avatar.png", bytes);
  const before = await runtime.bots.profile(botId, context);
  const tool = imageExtension(
    () => {
      throw new Error("generation should not run");
    },
    () => runtime.bots,
  ).tools[1];
  const api = {
    conversationId: botId,
    taskId: 123,
    callId: "avatar",
    snapshot: runtime.harness.snapshot.bind(runtime.harness),
  } as Parameters<typeof tool.execute>[1];
  const input = {
    name: "Godzilla",
    avatarFileId: file.id,
    coverFileId: file.id,
  };
  await tool.execute(input, api, context);
  const applied = await runtime.bots.profile(botId, context);
  expect(applied).toMatchObject({
    name: "Godzilla",
    instructions: before.instructions,
    avatarMedia: {
      src: expect.stringMatching(new RegExp(`^/files/${botId}/[a-f0-9]{64}$`)),
      cover: expect.stringMatching(
        new RegExp(`^/files/${botId}/[a-f0-9]{64}$`),
      ),
    },
  });
  expect(applied.avatarMedia?.src).not.toBe(`/files/${botId}/${file.id}`);
  expect(
    (await runtime.bots.list(context)).find((bot) => bot.id === botId)
      ?.avatarMedia,
  ).toEqual(applied.avatarMedia);
  await runtime.bots.updateIdentity(
    botId,
    { name: "New name" },
    "later-change",
    context,
  );
  await tool.execute(input, api, context);
  expect((await runtime.bots.profile(botId, context)).name).toBe("New name");
  expect((await runtime.bots.profile(other.id, context)).name).toBe("Other");
  await expect(
    tool.execute({ ...input, name: "Changed request" }, api, context),
  ).rejects.toThrow("标识冲突");
  runtime.bots.images = {
    avatarRevision: async () => before.revision,
  } as unknown as ImageServices;
  await expect(
    runtime.bots.updateIdentity(
      botId,
      { avatarFileId: file.id, coverFileId: file.id },
      "late-image",
      context,
    ),
  ).rejects.toThrow();
  expect((await runtime.bots.profile(botId, context)).name).toBe("New name");
  await expect(
    runtime.bots.updateIdentity(
      botId,
      { name: "Stale", revision: before.revision },
      "stale",
      context,
    ),
  ).rejects.toThrow();
  await runtime.bots.updateIdentity(
    botId,
    { resetAvatar: true },
    "reset",
    context,
  );
  expect(
    (await runtime.bots.profile(botId, context)).avatarMedia,
  ).toBeUndefined();
});
