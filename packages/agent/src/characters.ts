import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CharacterMedia } from "@domos/ui/characters";
import type { Context } from "@earendil-works/chord/context";
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import type { Computers } from "./computer/catalog.ts";
import { ComputersDoc } from "./computer/state.ts";
import type { Files } from "./files.ts";

export type SavedCharacter = {
  id: string;
  computerId: string;
  name: string;
  imageType: string;
  coverType: string;
  media: CharacterMedia;
};
const CharactersDoc = defineDoc<{ items: SavedCharacter[] }>({
  kind: "domos.characters",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ items: [] }),
});
export class Characters {
  private readonly harness: Harness;
  private readonly files: Files;
  private readonly computers?: Computers;
  constructor(harness: Harness, files: Files, computers?: Computers) {
    this.harness = harness;
    this.files = files;
    this.computers = computers;
  }
  private async computer(botId: number | undefined, context: Context) {
    if (!this.computers) return "local";
    if (botId) {
      const binding = await this.computers.binding(botId, context);
      if (!binding.computer?.authorized) throw new Error("请先授权工作电脑。");
      return binding.computer.id;
    }
    const list = await this.harness.snapshot(ComputersDoc, context);
    const computer = list?.items.find(
      (item) => item.id === "process" && item.authorized,
    );
    if (!computer) throw new Error("请先选择并授权工作电脑。");
    return computer.id;
  }
  async list(botId: number | undefined, context: Context) {
    const computerId = await this.computer(botId, context);
    return (
      (await this.harness.snapshot(CharactersDoc, context))?.items ?? []
    ).filter((item) => item.computerId === computerId);
  }
  async forCreation(
    id: string,
    computerId: string | null | undefined,
    context: Context,
  ) {
    const asset = await this.get(id, context);
    if (computerId === null) throw new Error("请先选择并授权工作电脑。");
    const selected = computerId ?? (await this.computer(undefined, context));
    if (asset.computerId !== selected)
      throw new Error("角色属于另一台工作电脑。");
    return asset;
  }
  path(id: string, part: "image" | "cover") {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("角色不存在。");
    return join(this.files.root, ".characters", id, part);
  }
  async get(id: string, context: Context) {
    const asset = (
      await this.harness.snapshot(CharactersDoc, context)
    )?.items.find((item) => item.id === id);
    if (!asset) throw new Error("角色不存在。");
    if (this.computers) {
      const computers = await this.harness.snapshot(ComputersDoc, context);
      if (
        !computers?.items.some(
          (item) => item.id === asset.computerId && item.authorized,
        )
      )
        throw new Error("工作电脑尚未授权。");
    }
    return asset;
  }
  async save(
    botId: number,
    name: string,
    imageId: string,
    coverId: string,
    context: Context,
  ) {
    const computerId = await this.computer(botId, context);
    const originals = await Promise.all(
      [imageId, coverId].map(async (id) => {
        const file = await this.files.metadata(botId, id);
        await this.files.verify(botId, [file], context);
        if (
          file.size > 32 * 1024 * 1024 ||
          !/^image\/(png|jpeg|gif|webp)$/.test(file.mimeType ?? "")
        )
          throw new Error("角色文件格式或大小不支持。");
        const path = join(this.files.directory(botId, id), "content");
        const preview = await this.files.previews.read(
          file,
          path,
          undefined,
          context.abortSignal,
        );
        if (preview.kind !== "image") throw new Error("角色文件无效。");
        const metadata = {
          width: preview.width,
          height: preview.height,
          pages: preview.frames,
        };
        if (
          !metadata.width ||
          !metadata.height ||
          (metadata.pages ?? 1) > 16 ||
          metadata.width * metadata.height * (metadata.pages ?? 1) >
            16 * 1024 * 1024
        )
          throw new Error("角色尺寸或帧数超过预算。");
        return { file, path, metadata };
      }),
    );
    const image = originals[0];
    const cover = originals[1];
    if (!image || !cover) throw new Error("角色文件缺失。");
    if ((cover.metadata.pages ?? 1) !== 1)
      throw new Error("角色封面必须是静态图片。");
    const bytes = await Promise.all(
      originals.map((item) => readFile(item.path)),
    );
    const imageBytes = bytes[0];
    const coverBytes = bytes[1];
    if (!imageBytes || !coverBytes) throw new Error("角色文件缺失。");
    const id = createHash("sha256")
      .update(computerId)
      .update(imageBytes)
      .update(coverBytes)
      .digest("hex");
    await mkdir(join(this.files.root, ".characters", id), { recursive: true });
    for (const part of ["image", "cover"] as const) {
      const path = this.path(id, part);
      const bytes = part === "image" ? imageBytes : coverBytes;
      const temporary = `${path}.${randomUUID()}`;
      try {
        await writeFile(temporary, bytes, { mode: 0o600 });
        try {
          await rename(temporary, path);
        } catch (error) {
          const retained = await readFile(path).catch(() => undefined);
          if (!retained?.equals(bytes)) throw error;
        }
      } finally {
        await rm(temporary, { force: true });
      }
    }
    const media = {
      src: `/files/characters/${id}/image`,
      cover: `/files/characters/${id}/cover`,
      headset: { x: 50, y: 30, scale: 0.64 },
      computer: { x: 50, y: 48, scale: 0.82 },
    };
    const asset = {
      id,
      computerId,
      name,
      imageType: image.file.mimeType ?? "image/webp",
      coverType: cover.file.mimeType ?? "image/png",
      media,
    };
    context.abortSignal?.throwIfAborted();
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(CharactersDoc);
      if (!doc.items.some((item) => item.id === id)) doc.items.push(asset);
    }, context);
    return this.get(id, context);
  }
  async apply(botId: number, id: string, context: Context) {
    const asset = await this.get(id, context);
    if (asset.computerId !== (await this.computer(botId, context)))
      throw new Error("角色属于另一台工作电脑。");
    // Each Bot owns its delivery files; the retained catalog survives source attachment cleanup.
    const files = await Promise.all(
      (["image", "cover"] as const).map(async (part) => {
        const path = this.path(id, part);
        if ((await stat(path)).size > 32 * 1024 * 1024)
          throw new Error("角色超过预算。");
        return this.files.upload(
          botId,
          part === "cover"
            ? "character-cover.png"
            : `character.${asset.imageType.split("/")[1]}`,
          await readFile(path),
          context,
          `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`,
        );
      }),
    );
    if (!files[0] || !files[1]) throw new Error("角色文件缺失。");
    return {
      ...asset.media,
      src: `/files/${botId}/${files[0].id}`,
      cover: `/files/${botId}/${files[1].id}`,
    };
  }
}
