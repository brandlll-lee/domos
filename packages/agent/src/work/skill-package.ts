import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Files } from "../files.ts";
import { SKILL_PACKAGE_BYTES } from "./limits.ts";
import { parseSkill } from "./skill-format.ts";
import { WorkError } from "./state.ts";

export function skillPackage(content: string, archive?: string) {
  let bytes = 0;
  let count = 0;
  if (archive && archive.length > SKILL_PACKAGE_BYTES * 2)
    throw new WorkError("BAD_REQUEST", "技能包超过 8 MiB。");
  const files = archive
    ? unzipSync(Buffer.from(archive, "base64"), {
        filter: (file) => {
          bytes += file.originalSize;
          count++;
          if (bytes > SKILL_PACKAGE_BYTES || count > 512)
            throw new WorkError("BAD_REQUEST", "技能文件过大。");
          return !file.name.endsWith("/");
        },
      })
    : {};
  const roots = Object.keys(files).filter(
    (path) => path === "SKILL.md" || path.endsWith("/SKILL.md"),
  );
  if (archive && !files["SKILL.md"] && roots.length === 1) {
    const prefix = roots.join("").slice(0, -8);
    for (const [path, data] of Object.entries(files)) {
      if (!path.startsWith(prefix))
        throw new WorkError("BAD_REQUEST", "ZIP 只能包含一个技能目录。");
      files[path.slice(prefix.length)] = data;
      delete files[path];
    }
  }
  if (content) files["SKILL.md"] = strToU8(content);
  if (!files["SKILL.md"]) throw new WorkError("BAD_REQUEST", "缺少 SKILL.md。");
  const text = strFromU8(files["SKILL.md"]);
  const parsed = parseSkill(text);
  let size = 0;
  const hash = createHash("sha256");
  const paths = Object.keys(files).sort();
  if (paths.length > 256)
    throw new WorkError("BAD_REQUEST", "技能包最多包含 256 个文件。");
  for (const [path, data] of Object.entries(files).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (
      Array.from(path).some((char) => char.charCodeAt(0) < 32) ||
      path.includes("\\") ||
      path.includes(":") ||
      path.startsWith("/") ||
      posix.normalize(path) !== path ||
      path.split("/").some((part) => part === ".." || !part)
    )
      throw new WorkError("BAD_REQUEST", "技能路径无效。");
    size += data.length;
    if (size > SKILL_PACKAGE_BYTES)
      throw new WorkError("BAD_REQUEST", "技能包超过 8 MiB。");
    hash
      .update(path)
      .update("\0")
      .update(String(data.length))
      .update("\0")
      .update(data);
  }
  return { ...parsed, content: text, files, paths, hash: hash.digest("hex") };
}

export class SkillPackages {
  private readonly files: Files;
  constructor(files: Files) {
    this.files = files;
  }
  private path(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash))
      throw new WorkError("BAD_REQUEST", "版本哈希无效。");
    return join(this.files.root, "skills", `${hash}.zip`);
  }
  async read(hash: string) {
    return (await readFile(this.path(hash))).toString("base64");
  }
  async store(bundle: ReturnType<typeof skillPackage>) {
    const path = this.path(bundle.hash);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, zipSync(bundle.files), { flag: "wx" }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
  }
  async materialize(botId: number, hash: string, context: Context) {
    const bundle = skillPackage("", await this.read(hash));
    const env = await this.files.workspace(botId, context);
    const root = `.domos/skills/${hash}/${bundle.name}`;
    for (const [path, data] of Object.entries(bundle.files)) {
      const target = `${root}/${path}`;
      getOrThrow(
        await env.createDir(
          posix.dirname(target),
          { recursive: true },
          context,
        ),
      );
      getOrThrow(await env.writeFile(target, data, context));
    }
    return env.path(`${root}/SKILL.md`);
  }
}
