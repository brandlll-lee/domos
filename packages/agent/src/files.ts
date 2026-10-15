import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import type { Context } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  section,
} from "@earendil-works/pi-durable";
import {
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";
import { fileTypeFromBuffer } from "file-type";
import { type Attachment, MAX_FILE_BYTES } from "./attachments.ts";
import { Workspace } from "./workspace.ts";

export const FileInput = "domos.file-input";

export class Files {
  readonly root: string;

  constructor(database: string) {
    this.root = resolve(`${database}.files`);
  }

  async workspace(botId: number) {
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

  async upload(botId: number, name: string, bytes: Uint8Array) {
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
    const file = await this.store(
      botId,
      `uploads/${digest}/${filename}`,
      bytes,
    );
    const workspace = await this.workspace(botId);
    const path = await workspace.path(file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    return file;
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
    const workspace = await this.workspace(botId);
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
        relative(workspace.cwd, resolved).split(sep).join("/"),
        bytes.value,
      );
    } finally {
      await reader.value.close(context);
    }
  }

  extension() {
    const files = this;
    return defineExtension({
      name: "domos-files",
      tools: [
        ...[createReadTool(), createWriteTool(), createEditTool()].map(
          (tool) => ({ ...tool, executionMode: "sequential" as const }),
        ),
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
            "File paths are relative to this Bot's private workspace. Read uploaded text files with read. Create or edit deliverables with write/edit, then publish them with attach_file. Only published files are downloadable. Do not claim to process unsupported file formats.",
        ),
      ],
    });
  }
}
