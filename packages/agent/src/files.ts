import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, posix, resolve, win32 } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import {
  createEditTool,
  createReadTool,
  createWriteTool,
  type ImageProcessor,
} from "@earendil-works/pi-durable/tools";
import { fileTypeFromBuffer } from "file-type";
import { type Attachment, MAX_FILE_BYTES } from "./attachments.ts";
import { type WorkEnvironment, Workspace } from "./workspace.ts";

export const FileInput = "domos.file-input";

export class Files {
  readonly root: string;
  private readonly environment:
    | ((botId: number, context: Context) => Promise<WorkEnvironment>)
    | undefined;

  constructor(
    database: string,
    environment?: (botId: number, context: Context) => Promise<WorkEnvironment>,
  ) {
    this.root = resolve(`${database}.files`);
    this.environment = environment;
  }

  async workspace(botId: number, context = BACKGROUND_CONTEXT) {
    if (this.environment) return this.environment(botId, context);
    const cwd = join(this.root, String(botId), "workspace");
    await mkdir(cwd, { recursive: true });
    return new Workspace({ cwd });
  }

  private directory(botId: number, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid file ID");
    return join(this.root, String(botId), "artifacts", id);
  }

  private async store(
    botId: number,
    path: string,
    bytes: Uint8Array,
  ): Promise<Attachment> {
    if (bytes.byteLength > MAX_FILE_BYTES)
      throw new Error("File exceeds 10 MiB");
    const id = createHash("sha256")
      .update(path)
      .update("\0")
      .update(bytes)
      .digest("hex");
    const mimeType =
      (await fileTypeFromBuffer(bytes).catch(() => undefined))?.mime ??
      "application/octet-stream";
    const file = {
      id,
      name: basename(path),
      size: bytes.byteLength,
      path,
      mimeType,
    };
    const directory = this.directory(botId, id);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, randomUUID());
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, join(directory, "content"));
      await writeFile(temporary, JSON.stringify(file));
      await rename(temporary, join(directory, "metadata.json"));
    } finally {
      await rm(temporary, { force: true });
    }
    return file;
  }

  async upload(
    botId: number,
    name: string,
    bytes: Uint8Array,
    context = BACKGROUND_CONTEXT,
  ) {
    const filename = basename(win32.basename(name)).trim();
    if (
      !filename ||
      filename === "." ||
      filename === ".." ||
      [...filename].some(
        (character) => character.charCodeAt(0) < 32 || character === ":",
      )
    )
      throw new Error("Invalid file name");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength > MAX_FILE_BYTES)
      throw new Error("File exceeds 10 MiB");
    const filePath = `uploads/${digest}/${filename}`;
    const workspace = await this.workspace(botId, context);
    const path = await workspace.path(filePath);
    const parent = getOrThrow(await workspace.joinPath([path, ".."], context));
    getOrThrow(await workspace.createDir(parent, { recursive: true }, context));
    const temporary = getOrThrow(
      await workspace.joinPath([parent, randomUUID()], context),
    );
    try {
      getOrThrow(await workspace.writeFile(temporary, bytes, context));
      getOrThrow(await workspace.renameFile(temporary, path, context));
    } finally {
      await workspace.remove(temporary, { force: true }, context);
    }
    return this.store(botId, filePath, bytes);
  }

  async metadata(botId: number, id: string): Promise<Attachment> {
    const file: Attachment = JSON.parse(
      await readFile(join(this.directory(botId, id), "metadata.json"), "utf8"),
    );
    if (!file.mimeType) {
      const bytes = await readFile(join(this.directory(botId, id), "content"));
      file.mimeType =
        (await fileTypeFromBuffer(bytes).catch(() => undefined))?.mime ??
        "application/octet-stream";
      await writeFile(
        join(this.directory(botId, id), "metadata.json"),
        JSON.stringify(file),
      );
    }
    return file;
  }

  async download(botId: number, id: string) {
    const file = await this.metadata(botId, id);
    const bytes = await readFile(join(this.directory(botId, id), "content"));
    return new File([bytes], file.name, { type: file.mimeType });
  }

  async publish(botId: number, path: string, context: Context) {
    const workspace = await this.workspace(botId, context);
    const resolved = await workspace.path(path);
    const reader = await workspace.openBinaryReader(
      resolved,
      undefined,
      context,
    );
    if (!reader.ok) throw reader.error;
    try {
      const info = await reader.value.info(context);
      if (!info.ok) throw info.error;
      if (info.value.kind !== "file")
        throw new Error("Only files can be attached");
      const bytes = await reader.value.read(0, MAX_FILE_BYTES + 1, context);
      if (!bytes.ok) throw bytes.error;
      return this.store(
        botId,
        (resolved.startsWith("/") ? posix : win32)
          .relative(workspace.cwd, resolved)
          .replaceAll("\\", "/"),
        bytes.value,
      );
    } finally {
      await reader.value.close(context);
    }
  }

  extension(images?: ImageProcessor) {
    const files = this;
    return defineExtension({
      name: "domos-files",
      tools: [
        ...[
          createReadTool({ images }),
          createWriteTool(),
          createEditTool(),
        ].map((tool) => ({ ...tool, executionMode: "sequential" as const })),
        defineTool({
          name: "attach_file",
          description:
            "Publish a workspace file as a downloadable chat attachment. Use after creating the final deliverable.",
          parameters: Type.Object({ path: Type.String() }),
          executionMode: "sequential",
          async execute(args, api, context) {
            const file = await files.publish(
              api.conversationId,
              args.path,
              context,
            );
            return {
              output: [
                {
                  type: "text",
                  text: `Attached ${file.name} (${file.size} bytes)`,
                },
              ],
              details: { attachment: file },
            };
          },
        }),
      ],
      sections: [
        section(
          "workspace",
          () =>
            "File paths are relative to this Bot's working directory on the selected computer. Bots sharing a computer share its OS permissions. Read uploaded text files with read. Create or edit deliverables with write/edit, then publish them with attach_file. Published files are durable snapshots, available even when the work computer is stopped. Do not claim to process unsupported file formats.",
        ),
      ],
    });
  }
}
