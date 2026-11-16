import type { Context } from "@earendil-works/chord/context";
import { type CredentialStore, Type } from "@earendil-works/pi-ai";
import { defineDoc, defineTool } from "@earendil-works/pi-durable";
import { BotDirectory, type Bots } from "./bots.ts";
import type { Computers } from "./computer/catalog.ts";
import { owningBot } from "./conversations.ts";
import type { Files } from "./files.ts";
import { imageBaseUrl } from "./harness/image-service.mjs";
import { requireRevision, toolResult } from "./work/state.ts";

export const imageModels = [
  "gpt-image-2.6-flare",
  "gpt-image-2.6-sunburst",
] as const;
export type ImageSettings = {
  name: string;
  baseUrl: string;
  model: (typeof imageModels)[number];
  quality: "low" | "medium" | "high";
  complexity: "low" | "medium" | "high";
  revision: number;
};
const defaults: ImageSettings = {
  name: "图像生成",
  baseUrl: "https://8stoken.com/v1",
  model: imageModels[0],
  quality: "high",
  complexity: "high",
  revision: 0,
};
const ImageServicesDoc = defineDoc<{ items: Record<string, ImageSettings> }>({
  kind: "domos.image-services",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ items: {} }),
});
const ImageIdentity = defineDoc<{
  requests: Record<
    string,
    { botId: number; revision: number; files: string[] }
  >;
}>({
  kind: "domos.image-identity",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ requests: {} }),
});
export type ImageInput = {
  prompt: string;
  model?: (typeof imageModels)[number];
  format?: "png" | "webp" | "gif";
  count?: number;
  quality?: ImageSettings["quality"];
  complexity?: ImageSettings["complexity"];
  frames?: number;
  frameDurationMs?: number;
  transparent?: boolean;
  keyColor?: string;
  referenceFiles?: string[];
};
type Generated = {
  files: {
    original: string;
    path: string;
    cover: string;
    width: number;
    height: number;
    frames: number;
    delay: number[];
    format: string;
  }[];
};

export class ImageServices {
  private readonly harness: import("@earendil-works/pi-durable").Harness;
  private readonly computers: Computers;
  private readonly files: Files;
  private readonly credentials?: CredentialStore;
  constructor(
    harness: import("@earendil-works/pi-durable").Harness,
    computers: Computers,
    files: Files,
    credentials?: CredentialStore,
  ) {
    this.harness = harness;
    this.computers = computers;
    this.files = files;
    this.credentials = credentials;
  }
  private async target(botId: number, context: Context) {
    const binding = await this.computers.binding(botId, context);
    if (!binding.computer?.authorized)
      throw new Error("请先授权 Bot 的工作电脑。");
    return binding.computer.id;
  }
  async state(botId: number, context: Context) {
    const computerId = await this.target(botId, context);
    const config =
      (await this.harness.snapshot(ImageServicesDoc, context))?.items[
        computerId
      ] ?? defaults;
    const credential = await this.credentials?.read(
      `domos-image:${computerId}`,
    );
    return {
      ...config,
      computerId,
      configured: credential?.type === "api_key",
      available: Boolean(this.credentials),
    };
  }
  async save(
    botId: number,
    input: ImageSettings & { computerId: string; apiKey?: string },
    context: Context,
  ) {
    const credentials = this.credentials;
    if (!credentials) throw new Error("当前服务未配置凭据存储。");
    const apiKey = input.apiKey?.trim();
    const current = await this.state(botId, context);
    if (current.computerId !== input.computerId)
      throw new Error("工作电脑已改变，请刷新后重试。");
    requireRevision(current.revision, input.revision);
    const baseUrl = imageBaseUrl(input.baseUrl);
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(ImageServicesDoc);
      requireRevision(
        doc.items[input.computerId]?.revision ?? 0,
        input.revision,
      );
      if (apiKey)
        await credentials.modify(
          `domos-image:${input.computerId}`,
          async () => ({ type: "api_key", key: apiKey }),
        );
      doc.items[input.computerId] = {
        name: input.name,
        baseUrl,
        model: input.model,
        quality: input.quality,
        complexity: input.complexity,
        revision: input.revision + 1,
      };
    }, context);
    return this.state(botId, context);
  }
  private async connection(botId: number, context: Context) {
    const settings = await this.state(botId, context);
    const secret = await this.credentials?.read(
      `domos-image:${settings.computerId}`,
    );
    if (secret?.type !== "api_key")
      throw new Error("请在 AI 服务中配置图像生成服务。");
    return { settings, key: secret.key };
  }
  async test(botId: number, context: Context) {
    const { settings, key } = await this.connection(botId, context);
    return this.computers.mcp<{ models: string[]; gifVerified: boolean }>(
      settings.computerId,
      { action: "image_test", baseUrl: settings.baseUrl, key },
      context,
      context.abortSignal,
      botId,
    );
  }
  async avatarRevision(botId: number, fileId: string, context: Context) {
    const requests =
      (await this.harness.snapshot(ImageIdentity, context))?.requests ?? {};
    return Object.values(requests).find(
      (item) => item.botId === botId && item.files.includes(fileId),
    )?.revision;
  }
  async generate(
    botId: number,
    input: ImageInput,
    requestId: string,
    context: Context,
  ) {
    const { settings, key } = await this.connection(botId, context);
    const references: string[] = [];
    let bytes = 0;
    for (const id of input.referenceFiles ?? []) {
      const metadata = await this.files.metadata(botId, id);
      await this.files.verify(botId, [metadata], context);
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(
          metadata.mimeType ?? "",
        )
      )
        throw new Error("参考图需要 PNG、JPEG 或 WebP。");
      bytes += metadata.size;
      if (bytes > 8 * 1024 * 1024)
        throw new Error("参考图总大小不能超过8 MiB。");
      const file = await this.files.download(botId, id);
      references.push(
        `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,
      );
    }
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(ImageIdentity);
      if (!doc.requests[requestId]) {
        const bot = (await tx.doc(BotDirectory)).items.find(
          (item) => item.id === botId,
        );
        doc.requests[requestId] = {
          botId,
          revision: bot?.revision ?? 0,
          files: [],
        };
      }
    }, context);
    const directory = (await this.computers.workspace(botId, context)).cwd;
    const generated = await this.computers.mcp<Generated>(
      settings.computerId,
      {
        action: "image_generate",
        baseUrl: settings.baseUrl,
        key,
        requestId,
        params: {
          ...input,
          model: input.model ?? settings.model,
          quality: input.quality ?? settings.quality,
          complexity: input.complexity ?? settings.complexity,
          format: input.format ?? "png",
          count: input.count ?? 1,
          frames: input.frames ?? 16,
          frameDurationMs: input.frameDurationMs ?? 100,
          references,
        },
      },
      context,
      context.abortSignal,
      botId,
    );
    const results = [];
    for (const item of generated.files) {
      context.abortSignal?.throwIfAborted();
      const original = await this.files.publish(
        botId,
        item.original,
        context,
        directory,
      );
      const file =
        item.path === item.original
          ? original
          : await this.files.publish(botId, item.path, context, directory);
      const cover = await this.files.publish(
        botId,
        item.cover,
        context,
        directory,
      );
      results.push({
        file,
        originalId: original.id,
        coverId: cover.id,
        width: item.width,
        height: item.height,
        frames: item.frames,
        delay: item.delay,
        format: item.format,
      });
    }
    const fileIds = results.map((item) => item.file.id);
    await this.harness.commit(async (tx) => {
      const receipt = (await tx.doc(ImageIdentity)).requests[requestId];
      if (receipt) receipt.files = fileIds;
    }, context);
    return results;
  }
}

const level = () =>
  Type.Union([
    Type.Literal("low"),
    Type.Literal("medium"),
    Type.Literal("high"),
  ]);
export function imageExtension(
  services: () => ImageServices,
  bots: () => Bots,
) {
  return {
    name: "domos-images",
    tools: [
      defineTool({
        name: "image_generate",
        description:
          "Generate ordinary images or GIFs using the work computer's configured image service. References are saved Files IDs. Only request transparent output when wanted; GIF transparency uses automatic colour-key removal and returns animated WebP. Choose a keyColor different from the subject. For avatar creation offer 3–4 still candidates with ask_question, then animate the selected reference; skip selection when the user requests it. Generation never changes identity. Results include saved file IDs, cover IDs and actual frame metadata; files are delivered automatically. Never resend an uncertain paid request. GIF requires provider preview access.",
        parameters: Type.Object({
          prompt: Type.String({ minLength: 1, maxLength: 32000 }),
          model: Type.Optional(
            Type.Union([
              Type.Literal(imageModels[0]),
              Type.Literal(imageModels[1]),
            ]),
          ),
          format: Type.Optional(
            Type.Union([
              Type.Literal("png"),
              Type.Literal("webp"),
              Type.Literal("gif"),
            ]),
          ),
          count: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })),
          quality: Type.Optional(level()),
          complexity: Type.Optional(level()),
          frames: Type.Optional(Type.Integer({ minimum: 2, maximum: 16 })),
          frameDurationMs: Type.Optional(
            Type.Integer({ minimum: 20, maximum: 2000 }),
          ),
          transparent: Type.Optional(Type.Boolean()),
          keyColor: Type.Optional(Type.String({ maxLength: 100 })),
          referenceFiles: Type.Optional(
            Type.Array(Type.String({ pattern: "^[a-f0-9]{64}$" }), {
              maxItems: 4,
            }),
          ),
        }),
        replay: "safe",
        executionMode: "sequential",
        async execute(input, api, context) {
          const botId = await owningBot(api, api.conversationId, context);
          const results = await services().generate(
            botId,
            input,
            `tool:${api.taskId}:${api.callId}`,
            context,
          );
          return {
            ...toolResult(
              results.map(({ file, ...rest }) => ({
                ...rest,
                fileId: file.id,
              })),
            ),
            details: { attachments: results.map((item) => item.file) },
          };
        },
      }),
      defineTool({
        name: "bot_update",
        description:
          "Update only your own Bot name or avatar when the user requests it. Use a saved image file ID and a static cover ID from image_generate. This applies an existing image without generating or removing its background. Use ask_question for requested candidate selection and wait for the real answer. Pass resetAvatar to restore the built-in character. No other Bot, instructions, credentials or arbitrary URLs can be changed.",
        parameters: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
          avatarFileId: Type.Optional(
            Type.String({ pattern: "^[a-f0-9]{64}$" }),
          ),
          coverFileId: Type.Optional(
            Type.String({ pattern: "^[a-f0-9]{64}$" }),
          ),
          revision: Type.Optional(
            Type.Integer({
              minimum: 0,
              description:
                "Use the current profile revision to explicitly apply older generated media after another identity change.",
            }),
          ),
          resetAvatar: Type.Optional(Type.Boolean()),
        }),
        replay: "safe",
        executionMode: "sequential",
        async execute(input, api, context) {
          const botId = await owningBot(api, api.conversationId, context);
          return toolResult(
            await bots().updateIdentity(
              botId,
              input,
              `tool:${api.taskId}:${api.callId}`,
              context,
            ),
          );
        },
      }),
    ] as const,
  };
}
