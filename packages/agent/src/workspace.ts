import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import {
  type ExecutionEnv,
  err,
  FileError,
  ok,
  type Result,
} from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { MAX_TEXT_FILE_BYTES } from "./attachments.ts";

export type WorkEnvironment = ExecutionEnv & {
  path(input: string): Promise<string>;
};

export class Workspace extends NodeExecutionEnv {
  async path(input: string) {
    const root = await realpath(this.cwd);
    const candidate = resolve(this.cwd, input);
    let local = relative(this.cwd, candidate);
    const outside = (value: string) =>
      value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value);
    if (outside(local)) local = relative(root, candidate);
    if (outside(local)) {
      // Windows application redirection and saved root aliases can name the same
      // directory. Resolve ancestors only; never follow a file or child link.
      let parent = candidate;
      while (true) {
        const actual = await realpath(parent).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        );
        if (actual && relative(root, actual) === "") {
          local = relative(parent, candidate);
          break;
        }
        const next = dirname(parent);
        if (next === parent) break;
        parent = next;
      }
    }
    if (
      outside(local) ||
      local.includes(":") ||
      local.split(sep).some((segment) => /[. ]$/.test(segment))
    )
      throw new FileError(
        "permission_denied",
        "Path is outside this Bot's workspace",
      );
    let current = root;
    for (const segment of ["", ...local.split(sep).filter(Boolean)]) {
      current = join(current, segment);
      const info = await lstat(current).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        },
      );
      if (info?.isSymbolicLink() || (info?.isFile() && info.nlink > 1))
        throw new FileError(
          "permission_denied",
          "Linked paths are outside the workspace capability",
        );
    }
    return resolve(root, local);
  }

  private async access<T>(
    path: string,
    operation: (path: string) => Promise<Result<T, FileError>>,
  ): Promise<Result<T, FileError>> {
    try {
      return await operation(await this.path(path));
    } catch (error) {
      return err(
        error instanceof FileError
          ? error
          : new FileError("unknown", "Workspace access failed"),
      );
    }
  }

  override absolutePath(path: string, _context: Context) {
    return this.access(path, async (value) => ok(value));
  }

  override exists(path: string, context: Context) {
    return this.access(path, (value) => super.exists(value, context));
  }

  override fileInfo(path: string, context: Context) {
    return this.access(path, (value) => super.fileInfo(value, context));
  }

  override readTextFile(path: string, context: Context) {
    return this.access<string>(path, async (value) => {
      const info = await super.fileInfo(value, context);
      if (!info.ok) return err(info.error);
      if (info.value.size > MAX_TEXT_FILE_BYTES)
        return err(new FileError("invalid", "Text exceeds 10 MiB"));
      return super.readTextFile(value, context);
    });
  }

  override openBinaryReader(
    path: string,
    _options: { noFollow?: boolean } | undefined,
    context: Context,
  ) {
    return this.access(path, (value) =>
      super.openBinaryReader(value, { noFollow: true }, context),
    );
  }

  override writeFile(
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    if (Buffer.byteLength(content) > MAX_TEXT_FILE_BYTES)
      return Promise.resolve(
        err(new FileError("invalid", "File exceeds 10 MiB")),
      );
    return this.access(path, (value) =>
      super.writeFile(value, content, context),
    );
  }
}
