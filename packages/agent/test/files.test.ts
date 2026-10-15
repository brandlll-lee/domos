import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { expect, onTestFinished, test } from "vitest";
import { MAX_FILE_BYTES } from "../src/attachments.ts";
import { chatView } from "../src/chat-view.ts";
import { Files } from "../src/files.ts";
import { openAgent } from "../src/open-agent.ts";

const context = BACKGROUND_CONTEXT;

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "domos-files-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const files = new Files(join(directory, "agent.sqlite"));
  return { directory, files, workspace: await files.workspace(1) };
}

test("file capabilities reject traversal, absolute escape, junctions, hard links, and alternate streams", async () => {
  const { directory, files, workspace } = await setup();
  const outside = join(directory, "outside");
  await mkdir(outside);
  const original = crypto.randomUUID();
  await writeFile(join(outside, "source.txt"), original);
  await symlink(outside, join(workspace.cwd, "linked"), "junction");
  await link(join(outside, "source.txt"), join(workspace.cwd, "hard.txt"));
  for (const path of [
    "../escape.txt",
    join(outside, "source.txt"),
    "linked/source.txt",
    "hard.txt",
    "valid.txt:stream",
    ".. /escape.txt",
  ]) {
    expect((await workspace.absolutePath(path, context)).ok).toBe(false);
    expect((await workspace.writeFile(path, "changed", context)).ok).toBe(
      false,
    );
    expect((await workspace.readTextFile(path, context)).ok).toBe(false);
    expect(
      (await workspace.openBinaryReader(path, undefined, context)).ok,
    ).toBe(false);
    await expect(files.publish(1, path, context)).rejects.toThrow();
  }
  expect(await readFile(join(outside, "source.txt"), "utf8")).toBe(original);
  const other = await files.workspace(2);
  expect(
    (await workspace.readTextFile(join(other.cwd, "file.txt"), context)).ok,
  ).toBe(false);
});

test("file limits apply to uploaded, generated, and published files", async () => {
  const { workspace, files } = await setup();
  const bytes = new Uint8Array(MAX_FILE_BYTES + 1);
  expect((await workspace.writeFile("large.txt", bytes, context)).ok).toBe(
    false,
  );
  await expect(files.upload(1, "large.txt", bytes)).rejects.toThrow("10 MiB");
  await writeFile(join(workspace.cwd, "large.txt"), bytes);
  await expect(files.publish(1, "large.txt", context)).rejects.toThrow(
    "10 MiB",
  );
  await expect(files.upload(1, "bad:stream", new Uint8Array())).rejects.toThrow(
    "Invalid file name",
  );
});

function png(width: number, height: number) {
  const chunk = (name: string, content: Buffer) => {
    const data = Buffer.concat([Buffer.from(name), content]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(content.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(data));
    return Buffer.concat([size, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 3 + 1) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("image reads resize to model limits, preserve originals, and retain decode diagnostics", async () => {
  const { directory, files } = await setup();
  const limits = { maxWidth: 840, maxHeight: 560, maxBytes: 500_000 };
  const faux = fauxProvider({
    models: [
      {
        id: "vision",
        input: ["text", "image"],
        inputLimits: { images: { resize: limits } },
      },
    ],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  registry.install(files.extension(await createNodePhotonImages()));
  const runtime = await openAgent(
    join(directory, "agent.sqlite"),
    {
      models,
      registry,
      env: ({ conversationId }) => files.workspace(conversationId),
    },
    { model: { provider: "faux", modelId: "vision" } },
    context,
  );
  try {
    const original = png(2700, 1800);
    const file = await files.upload(
      runtime.conversation.id,
      "photo.png",
      original,
    );
    const broken = await files.upload(
      runtime.conversation.id,
      "broken.png",
      original.subarray(0, 40),
    );
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("read", { path: file.path })], {
        stopReason: "toolUse",
      }),
      async (input) => {
        const result = input.messages.findLast(
          (message) => message.role === "toolResult",
        );
        const image = result?.content.find((part) => part.type === "image");
        expect(image?.type).toBe("image");
        if (image?.type !== "image") throw new Error("Image input missing");
        expect(image.mimeType).toBe("image/png");
        const bytes = Buffer.from(image.data, "base64");
        expect(bytes.readUInt32BE(16)).toBe(limits.maxWidth);
        expect(bytes.readUInt32BE(20)).toBe(limits.maxHeight);
        expect(image.data.length).toBeLessThanOrEqual(limits.maxBytes);
        return fauxAssistantMessage(
          [fauxToolCall("read", { path: broken.path })],
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("Image read checked"),
    ]);
    const submission = await runtime.conversation.submit(
      { type: "input", content: "Read both images" },
      context,
    );
    await submission.wait(context);
    const workspace = await files.workspace(runtime.conversation.id);
    expect(await readFile(join(workspace.cwd, file.path))).toEqual(original);
    const state = await runtime.conversation.viewState(context);
    try {
      const results = chatView(state.value).messages.filter(
        (message) => message.role === "toolResult",
      );
      expect(results).toHaveLength(2);
      expect(results[0]?.isError).toBe(false);
      expect(results[0]?.diagnostics?.length).toBeGreaterThan(0);
      expect(results[1]?.isError).toBe(true);
      expect(
        results[1]?.diagnostics?.some((item) => item.severity === "error"),
      ).toBe(true);
    } finally {
      state.dispose();
    }
  } finally {
    await runtime.harness.close(context);
  }
});
