import type { Context } from "@earendil-works/chord/context";
import { type CredentialStore, Type } from "@earendil-works/pi-ai";
import { defineDoc, defineTool } from "@earendil-works/pi-durable";
import type { Attachment } from "./attachments.ts";
import { BotDirectory, type Bots } from "./bots.ts";
import { Characters } from "./characters.ts";
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
  baseUrl: "https://api.openai.com/v1",
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
    {
      botId: number;
      revision: number;
      files: string[];
      scope?: { computerId: string; directory: string; fingerprint: string };
      published?: Record<string, Attachment>;
      generated?: Generated;
      results?: ImageResult[];
    }
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
  purpose?: "image" | "avatar";
  saveAsCharacter?: boolean;
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
export type ImagePreparation = {
  purpose: "image" | "avatar";
  status: "ready";
  transparent: boolean;
  animated: boolean;
};
type ImageResult = {
  preparation?: ImagePreparation;
  requestId?: string;
  file: Attachment;
  originalId: string;
  coverId: string;
  width: number;
  height: number;
  frames: number;
  delay: number[];
  format: string;
  characterId?: string;
};
type Generated = {
  files: {
    preparation?: ImagePreparation;
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
  async preparedAvatar(botId: number, reference: string, context: Context) {
    const requests =
      (await this.harness.snapshot(ImageIdentity, context))?.requests ?? {};
    const result = Object.values(requests)
      .filter((item) => item.botId === botId)
      .flatMap((item) => item.results ?? [])
      .find(
        (item) =>
          item.file.id === reference ||
          item.originalId === reference ||
          item.coverId === reference,
      );
    if (
      result?.preparation?.purpose !== "avatar" ||
      result.preparation.status !== "ready"
    )
      throw new Error(
        '需要制作头像：请使用 image_generate(purpose:"avatar", referenceFiles:[原文件ID])；完成后用最终 fileId 应用，仅明确要求原图直用时设置 useOriginal:true。',
      );
    return result;
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
  ): Promise<ImageResult[]> {
    return this.files.exclusive(botId, () =>
      this.computers.transfer(
        botId,
        () => this.generateBound(botId, input, requestId, context),
        context,
      ),
    );
  }
  private async generateBound(
    botId: number,
    input: ImageInput,
    requestId: string,
    context: Context,
  ) {
    if (input.purpose === "avatar")
      input = {
        ...input,
        format: input.format ?? "gif",
        transparent: input.transparent ?? true,
      };
    if (
      input.format &&
      input.format !== "gif" &&
      (input.frames !== undefined || input.frameDurationMs !== undefined)
    )
      throw new Error("静态格式不能指定动画帧参数。");
    if (input.frameDurationMs !== undefined && input.frameDurationMs % 10 !== 0)
      throw new Error("GIF每帧时长必须是10毫秒的倍数。");
    const { settings, key } = await this.connection(botId, context);
    const workspace = await this.computers.workspace(botId, context);
    const directory = workspace.cwd;
    const scope = {
      computerId: settings.computerId,
      directory,
      fingerprint: JSON.stringify({
        ...input,
        model: input.model ?? settings.model,
        quality: input.quality ?? settings.quality,
        complexity: input.complexity ?? settings.complexity,
        baseUrl: settings.baseUrl,
      }),
    };
    let receipt = (await this.harness.snapshot(ImageIdentity, context))
      ?.requests[requestId];
    if (
      receipt &&
      (receipt.botId !== botId ||
        (receipt.scope &&
          (receipt.scope.computerId !== scope.computerId ||
            receipt.scope.fingerprint !== scope.fingerprint ||
            (await workspace.path(receipt.scope.directory)) !==
              (await workspace.path(".")))))
    )
      throw new Error(
        "图像请求上下文已改变。请回到原工作电脑、目录和服务配置恢复原请求；不要重新发起付费生成。",
      );
    if (receipt?.results) return receipt.results;
    const references: string[] = [];
    let bytes = 0;
    for (const id of receipt?.generated ? [] : (input.referenceFiles ?? [])) {
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
          scope,
          published: {},
        };
      } else {
        const saved = doc.requests[requestId];
        if (
          saved.botId !== botId ||
          (saved.scope && saved.scope.fingerprint !== scope.fingerprint)
        )
          throw new Error("图像请求标识或上下文冲突。");
        saved.scope ??= scope;
      }
    }, context);
    receipt = (await this.harness.snapshot(ImageIdentity, context))?.requests[
      requestId
    ];
    const generated =
      receipt?.generated ??
      (await this.computers
        .mcp<Generated>(
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
        )
        .catch((error) => {
          if (context.abortSignal?.aborted) throw error;
          throw new Error(
            `图像生成或处理结果尚未确认。请仅用 {"recoverRequestId":${JSON.stringify(requestId)}} 检查并恢复已保存结果；不要重新付费生成。原因：${error instanceof Error ? error.message : "请求未完成。"}`,
          );
        }));
    return this.publishGenerated(
      botId,
      input,
      requestId,
      directory,
      generated,
      context,
    );
  }
  async recover(
    botId: number,
    requestId: string,
    context: Context,
  ): Promise<ImageResult[]> {
    return this.files.exclusive(botId, () =>
      this.computers.transfer(
        botId,
        async () => {
          const receipt = (await this.harness.snapshot(ImageIdentity, context))
            ?.requests[requestId];
          if (!receipt || receipt.botId !== botId || !receipt.scope)
            throw new Error("没有属于当前 Bot 的可恢复图像请求。");
          const computerId = await this.target(botId, context);
          const workspace = await this.computers.workspace(botId, context);
          if (
            computerId !== receipt.scope.computerId ||
            (await workspace.path(receipt.scope.directory)) !==
              (await workspace.path("."))
          )
            throw new Error("请在原工作电脑和原目录恢复图像。");
          if (receipt.results) return receipt.results;
          const generated = await this.computers.mcp<Generated>(
            computerId,
            { action: "image_recover", requestId },
            context,
            context.abortSignal,
            botId,
          );
          const input = JSON.parse(receipt.scope.fingerprint) as ImageInput;
          return this.publishGenerated(
            botId,
            input,
            requestId,
            workspace.cwd,
            generated,
            context,
          );
        },
        context,
      ),
    );
  }
  private async publishGenerated(
    botId: number,
    input: ImageInput,
    requestId: string,
    directory: string,
    generated: Generated,
    context: Context,
  ): Promise<ImageResult[]> {
    try {
      await this.harness.commit(async (tx) => {
        const saved = (await tx.doc(ImageIdentity)).requests[requestId];
        if (!saved) throw new Error("原请求记录不存在。");
        saved.generated = generated;
      }, context);
      const receipt = (await this.harness.snapshot(ImageIdentity, context))
        ?.requests[requestId];
      const published = receipt?.published ?? {};
      const publish = async (path: string) => {
        if (published[path]) return published[path];
        const file = await this.files.publish(botId, path, context, directory);
        await this.harness.commit(async (tx) => {
          const saved = (await tx.doc(ImageIdentity)).requests[requestId];
          if (!saved) throw new Error("图像发布记录丢失。");
          saved.published ??= {};
          saved.published[path] = file;
        }, context);
        published[path] = file;
        return file;
      };
      const results: ImageResult[] = [];
      for (const item of generated.files) {
        context.abortSignal?.throwIfAborted();
        const original = await publish(item.original);
        const file =
          item.path === item.original ? original : await publish(item.path);
        const cover = await publish(item.cover);
        results.push({
          ...(item.preparation ? { preparation: item.preparation } : {}),
          requestId,
          ...(input.saveAsCharacter
            ? {
                characterId: (
                  await new Characters(
                    this.harness,
                    this.files,
                    this.computers,
                  ).save(
                    botId,
                    input.prompt.slice(0, 80),
                    file.id,
                    cover.id,
                    context,
                    item.preparation,
                  )
                ).id,
              }
            : {}),
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
        if (receipt) {
          receipt.files = fileIds;
          receipt.results = results;
        }
      }, context);
      return results;
    } catch (error) {
      if (context.abortSignal?.aborted) throw error;
      throw new Error(
        `图片已生成并保留，发布失败。请调用 image_generate，仅传 {"recoverRequestId":${JSON.stringify(requestId)}} 恢复交付；不要重新生成或要求重新上传。原因：${error instanceof Error ? error.message : "发布未完成。"}`,
      );
    }
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
          "Generate ordinary images or GIFs using the work computer's configured image service. References must use exact fileId values from uploaded file references or attach_file, never a path, path digest or characterId. References support PNG/JPEG/WebP only, at most 4 files and 8 MiB combined; uploading a GIF or larger image does not make it a supported editing reference. For ordinary images request transparent output only when wanted; avatar purpose defaults to transparency. GIF transparency uses automatic colour-key removal and returns animated WebP. Choose a keyColor different from the subject. For avatar creation always set purpose:avatar; it supplies animation and transparency defaults with explicit parameter overrides. An uploaded reference is already selected. Offer candidates through ask_question only when requested. Generation never changes identity. Results include saved file IDs, cover IDs and actual frame metadata; files are delivered automatically. Never resend an uncertain paid request. If a failure supplies recoverRequestId, call this same tool with only that field to publish the retained result without generation or provider credentials. GIF requires provider preview access.",
        parameters: Type.Object({
          purpose: Type.Optional(
            Type.Union([Type.Literal("image"), Type.Literal("avatar")], {
              description:
                "Default image. Use avatar for Bot-avatar creation: defaults GIF, transparency and cover. Explicit format and transparent:false override defaults. Uploaded reference is already selected; ask candidates only if requested.",
            }),
          ),
          saveAsCharacter: Type.Optional(
            Type.Boolean({
              description:
                "Save validated character media to this work computer's reusable character catalog. Ordinary generated images are not saved as characters by default.",
            }),
          ),
          recoverRequestId: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 256,
              description:
                "Recover a saved result belonging to this Bot. Supply only this field; no provider call is made.",
            }),
          ),
          prompt: Type.Optional(
            Type.String({ minLength: 1, maxLength: 32000 }),
          ),
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
          if (
            input.recoverRequestId &&
            Object.keys(input).some((key) => key !== "recoverRequestId")
          )
            throw new Error("恢复交付只传 recoverRequestId。");
          if (!input.recoverRequestId && !input.prompt?.trim())
            throw new Error("新生成需要 prompt。");
          const results = input.recoverRequestId
            ? await services().recover(botId, input.recoverRequestId, context)
            : await services().generate(
                botId,
                { ...input, prompt: input.prompt ?? "" },
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
        name: "character_list",
        description:
          "List reusable character catalog entries on your owning work computer. characterId is only for bot_update.avatarAssetId, never a fileId. This does not generate or apply media.",
        parameters: Type.Object({}),
        replay: "safe",
        executionMode: "sequential",
        async execute(_input, api, context) {
          const botId = await owningBot(api, api.conversationId, context);
          return toolResult(
            (await bots().characters.list(botId, context)).map(
              ({ id, name, preparation }) => ({
                kind: "character",
                characterId: id,
                name,
                preparation: preparation ?? { status: "unknown" },
              }),
            ),
          );
        },
      }),
      defineTool({
        name: "bot_update",
        description:
          "Update only your own Bot name or avatar when the user requests it. Use the final saved image file ID from image_generate. Use the final fileId from a ready purpose:avatar result; its cover is resolved automatically. Unprepared uploads require avatar generation first. useOriginal:true is only for explicit original-media use. This tool never generates or charges. Use ask_question for requested candidate selection and wait for the real answer. Pass resetAvatar to restore the built-in character. No other Bot, instructions, credentials or arbitrary URLs can be changed.",
        parameters: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
          avatarAssetId: Type.Optional(
            Type.String({
              pattern: "^[a-f0-9]{64}$",
              description:
                "characterId from character_list or image_generate.saveAsCharacter. Not a Files fileId.",
            }),
          ),
          useOriginal: Type.Optional(
            Type.Boolean({
              description:
                "Only true when user explicitly requests using original media unchanged. Never infer from an ordinary avatar request.",
            }),
          ),
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
