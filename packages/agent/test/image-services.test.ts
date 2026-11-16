import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, defineDoc } from "@earendil-works/pi-durable";
import sharp from "sharp";
import { expect, onTestFinished, test, vi } from "vitest";
import { Computers } from "../src/computer/catalog.ts";
import { Files } from "../src/files.ts";
import {
  prepareImage,
  removeBackground,
} from "../src/harness/image-processing.mjs";
import { imageBaseUrl } from "../src/harness/image-service.mjs";
import { WorkProcess } from "../src/harness/process.ts";
import { productCatalog } from "../src/harness/product-tools.ts";
import type { EngineRuntime } from "../src/harness/task-types.ts";
import { ImageServices, imageExtension } from "../src/image-services.ts";
import { openAgent } from "../src/open-agent.ts";
import { parseConfig } from "../src/runtime/config.ts";
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

test("paid results resume partial publishing without reference files and reject changed context", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  onTestFinished(() => runtime.harness.close(context));
  const id = runtime.conversation.id;
  const bytes = await sharp(pixels(24, 1), {
    raw: { width: 24, height: 24, channels: 4 },
  })
    .png()
    .toBuffer();
  const reference = await runtime.files.upload(
    id,
    "reference.png",
    bytes,
    context,
  );
  const workspace = await runtime.files.workspace(id);
  let cwd = workspace.cwd;
  const original = join(cwd, "generated-original.png");
  const cover = join(cwd, "generated-cover.png");
  await writeFile(original, bytes);
  await writeFile(cover, bytes);
  const mcp = vi.fn(async () => ({
    files: [
      {
        original,
        path: original,
        cover,
        width: 24,
        height: 24,
        frames: 1,
        delay: [],
        format: "png",
      },
    ],
  }));
  const computers = {
    binding: async () => ({ computer: { id: "local", authorized: true } }),
    workspace: async () => ({
      cwd,
      path: async (value: string) => join(cwd, value === cwd ? "." : value),
    }),
    transfer: async <T>(_id: number, fn: () => Promise<T>) => fn(),
    mcp,
  } as unknown as Computers;
  const service = new ImageServices(runtime.harness, computers, runtime.files, {
    read: async () => ({ type: "api_key", key: "test-only" }),
    list: async () => [],
    delete: async () => {},
    modify: async () => undefined,
  } as CredentialStore);
  const publish = runtime.files.publish.bind(runtime.files);
  let failed = false;
  const spy = vi
    .spyOn(runtime.files, "publish")
    .mockImplementation(async (...args) => {
      if (args[1] === cover && !failed) {
        failed = true;
        throw new Error("publish interrupted");
      }
      return publish(...args);
    });
  const input = { prompt: "blonde", referenceFiles: [reference.id] };
  await expect(service.generate(id, input, "retry", context)).rejects.toThrow(
    "publish interrupted",
  );
  expect(mcp).toHaveBeenCalledTimes(1);
  await runtime.files.discard(id, reference.id);
  const result = await service.generate(id, input, "retry", context);
  expect(result).toHaveLength(1);
  expect(mcp).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls.filter((call) => call[1] === original)).toHaveLength(1);
  expect(await service.generate(id, input, "retry", context)).toEqual(result);
  expect(mcp).toHaveBeenCalledTimes(1);
  cwd = join(cwd, "different");
  await expect(service.generate(id, input, "retry", context)).rejects.toThrow(
    "上下文",
  );
  expect(mcp).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});

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
  expect(await readFile(join(directory, file.original))).toEqual(gif);
  const output = sharp(join(directory, file.path), { animated: true });
  expect(await output.metadata()).toMatchObject({
    format: "webp",
    pages: 2,
    delay: [100, 100],
    hasAlpha: true,
  });
  const data = await output.ensureAlpha().raw().toBuffer();
  expect(data[3]).toBe(0);
  expect(data[(12 * 24 + 12) * 4 + 3]).toBe(255);
  expect(await sharp(join(directory, file.cover)).metadata()).toMatchObject({
    format: "png",
  });
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
  await expect(
    worker.mcp({ ...input, baseUrl: `${input.baseUrl}/changed` }),
  ).rejects.toThrow("请求标识");
  const otherDirectory = join(directory, "other");
  await mkdir(otherDirectory, { recursive: true });
  const movedWorker = new WorkProcess(
    [
      process.execPath,
      fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
    ],
    { cwd: otherDirectory, home: directory },
    [],
    async () => ({ content: [] }),
  );
  try {
    await movedWorker.ready;
    await expect(movedWorker.mcp(input)).rejects.toThrow("请求标识");
  } finally {
    await movedWorker.close();
  }
  expect(calls).toBe(1);
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
        callable: [
          { name: "image_generate" },
          { name: "character_list" },
          { name: "bot_update" },
        ],
      }),
      snapshot: runtime.harness.snapshot.bind(runtime.harness),
    } as unknown as EngineRuntime,
    context,
  );
  expect(catalog.map((item) => item.name)).toEqual(
    expect.arrayContaining(["image_generate", "bot_update", "character_list"]),
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
  ).tools[2];
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
  const characterTool = extension.tools[1];
  const listed = await characterTool.execute({}, api, context);
  expect(JSON.stringify(listed)).toContain(applied.avatarAssetId);
  expect(JSON.stringify(listed)).toContain("characterId");
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

test("real computer, worker and Files recover legacy directory aliases after restart without credentials or new generation", async () => {
  sharp.cache(false);
  const directory = await mkdtemp(join(tmpdir(), "domos-image-alias-"));
  const actual = join(directory, "actual");
  const alias = join(directory, "alias");
  await mkdir(actual);
  await symlink(
    actual,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  const requests: string[] = [];
  const bytes = await sharp(pixels(24, 1), {
    raw: { width: 24, height: 24, channels: 4 },
  })
    .png()
    .toBuffer();
  const provider = createServer(async (req, res) => {
    for await (const _chunk of req) {
    }
    requests.push(req.url ?? "");
    res.end(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }));
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  if (!address || typeof address === "string")
    throw new Error("provider address");
  const database = join(actual, "agent.sqlite");
  const config = parseConfig(
    { dataDir: alias },
    join(directory, "config.json"),
  );
  let computers = new Computers(config);
  let runtime: Awaited<ReturnType<typeof openAgent>> | undefined;
  let hasKey = true;
  const credentials: CredentialStore = {
    read: async () =>
      hasKey ? { type: "api_key", key: "test-only" } : undefined,
    list: async () => [],
    modify: async () => undefined,
    delete: async () => {},
  };
  const open = async () => {
    const files = new Files(
      database,
      (id, ctx, dir) => computers.workspace(id, ctx, undefined, dir),
      (id, ctx) => computers.computerId(id, ctx),
    );
    const registry = createRegistry();
    registry.install(files.extension());
    const opened = await openAgent(
      database,
      { registry, models: createModels() },
      {},
      context,
      files,
    );
    await computers.initialize(opened.harness, opened.bots, context, true);
    return opened;
  };
  onTestFinished(async () => {
    provider.closeAllConnections();
    provider.close();
    await computers.close(context);
    await runtime?.harness.close(context);
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  });
  runtime = await open();
  const botId = runtime.conversation.id;
  const workspace = await computers.workspace(botId, context);
  expect(workspace.cwd).toBe(await realpath(workspace.cwd));
  const uploaded = await runtime.files.upload(
    botId,
    "reference.png",
    bytes,
    context,
  );
  let service = new ImageServices(
    runtime.harness,
    computers,
    runtime.files,
    credentials,
  );
  await service.save(
    botId,
    {
      ...(await service.state(botId, context)),
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
    },
    context,
  );
  const publish = vi
    .spyOn(runtime.files, "publish")
    .mockRejectedValueOnce(new Error("publication interrupted"));
  const requestId = "retained-alias";
  await expect(
    service.generate(
      botId,
      { prompt: "golden hair", referenceFiles: [uploaded.id] },
      requestId,
      context,
    ),
  ).rejects.toThrow("recoverRequestId");
  publish.mockRestore();
  expect(requests).toEqual(["/v1/images/edits"]);
  const requestHash = createHash("sha256").update(requestId).digest("hex");
  const journal = join(
    actual,
    "engines",
    "image-requests",
    requestHash,
    "result.json",
  );
  const saved = JSON.parse(await readFile(journal, "utf8"));
  const legacyRoot = join(
    alias,
    "agent.sqlite.files",
    String(botId),
    "workspace",
  );
  const Receipt = defineDoc<{
    requests: Record<string, { scope: { directory: string } }>;
  }>({
    kind: "domos.image-identity",
    version: 1,
    checkpointWhen: () => false,
    scope: "session",
    initial: () => ({ requests: {} }),
  });
  await runtime.harness.commit(async (tx) => {
    const receipt = (await tx.doc(Receipt)).requests[requestId];
    if (!receipt) throw new Error("Missing saved receipt");
    receipt.scope.directory = legacyRoot;
  }, context);
  // Existing worker journals used absolute paths. Preserve that historical shape.
  await writeFile(journal, JSON.stringify(saved));
  hasKey = false;
  await runtime.files.discard(botId, uploaded.id);
  await computers.close(context);
  await runtime.harness.close(context);
  computers = new Computers(config);
  runtime = await open();
  service = new ImageServices(
    runtime.harness,
    computers,
    runtime.files,
    credentials,
  );
  const [first, second] = await Promise.all([
    service.recover(botId, requestId, context),
    service.recover(botId, requestId, context),
  ]);
  expect(first).toEqual(second);
  expect(first[0]?.file.id).toBeTruthy();
  expect(first[0]?.file.path.startsWith(".domos-generated/")).toBe(true);
  const file = first[0]?.file;
  if (!file) throw new Error("Missing recovered file");
  expect(
    Buffer.from(
      await (await runtime.files.download(botId, file.id)).arrayBuffer(),
    ),
  ).toEqual(bytes);
  expect(requests).toHaveLength(1);
  const bots = runtime.bots;
  const tool = imageExtension(
    () => service,
    () => bots,
  ).tools[0];
  const toolResult = await tool.execute(
    { recoverRequestId: requestId },
    {
      snapshot: runtime.harness.snapshot.bind(runtime.harness),
      conversationId: botId,
      taskId: 998,
      callId: "recover",
    } as Parameters<typeof tool.execute>[1],
    context,
  );
  expect(toolResult).toMatchObject({
    details: { attachments: [{ id: first[0]?.file.id }] },
  });
  expect(requests).toHaveLength(1);
  const other = await runtime.bots.create(
    { name: "Other", requestId: crypto.randomUUID() },
    context,
  );
  await expect(service.recover(other.id, requestId, context)).rejects.toThrow(
    "当前 Bot",
  );
  await expect(
    service.recover(botId, "another-bot-request", context),
  ).rejects.toThrow("当前 Bot");
  const escaped = join(actual, "outside.png");
  await writeFile(escaped, bytes);
  saved.files[0].original = escaped;
  await writeFile(journal, JSON.stringify(saved));
  await expect(
    computers.mcp(
      "process",
      { action: "image_recover", requestId },
      context,
      undefined,
      botId,
    ),
  ).rejects.toThrow("原请求");
  expect(requests).toHaveLength(1);
  const historical = await runtime.files.upload(
    botId,
    "historical.png",
    bytes,
    context,
  );
  await writeFile(
    join(runtime.files.directory(botId, historical.id), "metadata.json"),
    JSON.stringify({ ...historical, directory: legacyRoot }),
  );
  const reference = { ...historical };
  await runtime.files.verify(botId, [reference], context);
  expect(reference.id).toBe(historical.id);
  expect(
    await (await computers.workspace(botId, context)).path(reference.path),
  ).toBe(await realpath(join(legacyRoot, historical.path)));
  expect(
    Buffer.from(
      await (await runtime.files.download(botId, historical.id)).arrayBuffer(),
    ),
  ).toEqual(bytes);
}, 30000);
