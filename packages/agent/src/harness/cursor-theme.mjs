import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const run = promisify(execFile);

export function cursorTheme(source, color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Invalid cursor color");
  const rgb = color
    .slice(1)
    .match(/../g)
    .map((part) => parseInt(part, 16) / 255);
  const files = unzipSync(source);
  const manifest = JSON.parse(strFromU8(files["cua/theme.json"]));
  manifest.id = `app.domos.cursor.c${color.slice(1).toLowerCase()}`;
  manifest.name = `Domos ${color.toLowerCase()}`;
  files["cua/theme.json"] = strToU8(JSON.stringify(manifest));
  for (const name of Object.keys(files).filter((name) =>
    name.startsWith("a/"),
  )) {
    const animation = JSON.parse(strFromU8(files[name]));
    for (const layer of animation.layers)
      for (const shape of layer.shapes ?? [])
        if (
          shape.c?.k
            ?.slice(0, 3)
            .every(
              (value, index) =>
                Math.abs(value - [94, 192, 232][index] / 255) < 0.00001,
            )
        )
          shape.c.k = [...rgb, shape.c.k[3]];
    files[name] = strToU8(JSON.stringify(animation));
  }
  return {
    id: manifest.id,
    source: zipSync(files, {
      level: 6,
      mtime: new Date("2020-01-01T00:00:00Z"),
    }),
  };
}

export async function installCursorTheme(binary, home, color) {
  const theme = cursorTheme(
    await readFile(new URL("./cursor.lottie", import.meta.url)),
    color,
  );
  const hash = createHash("sha256").update(theme.source).digest("hex");
  const directory = join(home, ".domos", "cursor-themes", hash);
  const artifact = join(directory, "cursor.cua-theme");
  if (
    !(await access(artifact).then(
      () => true,
      () => false,
    ))
  ) {
    await mkdir(directory, { recursive: true });
    const source = join(directory, "cursor.lottie");
    await writeFile(source, theme.source);
    await run(binary, ["cursor-theme", "build", source, "--output", artifact], {
      windowsHide: true,
      timeout: 30000,
    });
  }
  await run(binary, ["cursor-theme", "install", artifact], {
    windowsHide: true,
    timeout: 10000,
  });
  return theme.id;
}
