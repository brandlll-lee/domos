import { posix } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  err,
  FileError,
  ok,
  type Result,
} from "@earendil-works/pi-durable/env";
import { RemoteExecutionEnv } from "@earendil-works/pi-env";
import { MAX_FILE_BYTES } from "../attachments.ts";
import { sandboxHome } from "./docker.ts";

export class SandboxWorkspace extends RemoteExecutionEnv {
  private readonly temporaryDirectory: string;

  constructor(
    options: ConstructorParameters<typeof RemoteExecutionEnv>[0],
    temporaryDirectory: string,
  ) {
    super(options);
    this.temporaryDirectory = posix.resolve(temporaryDirectory);
  }

  async path(input: string, context = BACKGROUND_CONTEXT) {
    const path = posix.resolve(this.cwd, input);
    const root = [sandboxHome, this.temporaryDirectory].find(
      (root) => path === root || path.startsWith(`${root}/`),
    );
    if (!root)
      throw new FileError(
        "permission_denied",
        "Path is outside the shared computer workspace",
      );
    let current = root;
    for (const segment of [
      "",
      ...posix.relative(root, path).split("/").filter(Boolean),
    ]) {
      current = posix.join(current, segment);
      const info = await super.fileInfo(current, context);
      if (!info.ok) {
        if (info.error.code === "not_found") break;
        throw info.error;
      }
      if (info.value.kind === "symlink")
        throw new FileError(
          "permission_denied",
          "Linked paths cannot be published or edited",
        );
      if (info.value.kind === "file" && info.value.size > MAX_FILE_BYTES)
        throw new FileError("invalid", "File exceeds 10 MiB");
    }
    return path;
  }

  private async access<T>(
    path: string,
    context: Context,
    operation: (path: string) => Promise<Result<T, FileError>>,
  ): Promise<Result<T, FileError>> {
    try {
      return await operation(await this.path(path, context));
    } catch (error) {
      return err(
        error instanceof FileError
          ? error
          : new FileError("unknown", "Sandbox workspace access failed"),
      );
    }
  }

  override absolutePath(path: string, context: Context) {
    return this.access(path, context, async (value) => ok(value));
  }

  override fileInfo(path: string, context: Context) {
    return this.access(path, context, (value) =>
      super.fileInfo(value, context),
    );
  }

  override readTextFile(path: string, context: Context) {
    return this.access(path, context, (value) =>
      super.readTextFile(value, context),
    );
  }

  override openBinaryReader(
    path: string,
    _options: { noFollow?: boolean } | undefined,
    context: Context,
  ) {
    return this.access(path, context, (value) =>
      super.openBinaryReader(value, { noFollow: true }, context),
    );
  }

  override writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    if (Buffer.byteLength(content) > MAX_FILE_BYTES)
      return Promise.resolve(
        err(new FileError("invalid", "File exceeds 10 MiB")),
      );
    return this.access(path, context, (value) =>
      super.writeFile(value, content, context),
    );
  }
}
