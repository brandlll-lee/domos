import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Unzip, UnzipInflate } from "fflate";
import * as XLSX from "xlsx";

const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;
const PREVIEW_ROWS = 500;
const PREVIEW_COLUMNS = 50;

async function inspectZip(path) {
  const handle = await import("node:fs/promises").then((fs) =>
    fs.open(path, "r"),
  );
  const signature = Buffer.alloc(4);
  try {
    await handle.read(signature, 0, 4, 0);
  } finally {
    await handle.close();
  }
  if (signature.readUInt32LE() !== 0x04034b50) return;
  let expanded = 0;
  let entries = 0;
  const unzip = new Unzip((file) => {
    if (++entries > MAX_ZIP_ENTRIES)
      throw new Error("压缩包条目过多，无法预览。请下载原文件。");
    file.ondata = (error, bytes) => {
      if (error) throw error;
      expanded += bytes.length;
      if (expanded > MAX_EXPANDED_BYTES)
        throw new Error("文件解压后超过预览预算。请下载原文件。");
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for await (const chunk of createReadStream(path)) unzip.push(chunk);
  unzip.push(new Uint8Array(), true);
}

async function preview(input) {
  if (input.kind === "image") {
    const { default: sharp } = await import("sharp");
    const metadata = await sharp(input.path, {
      animated: true,
      limitInputPixels: false,
    }).metadata();
    if (!metadata.width || !metadata.height)
      throw new Error("无法读取图片尺寸。");
    const { createNodePhotonImages } = await import(
      "@earendil-works/pi-durable/images/node"
    );
    const images = await createNodePhotonImages({ worker: false });
    const image = await images.prepare(
      await readFile(input.path),
      input.mimeType,
      {
        maxWidth: input.width ?? 160,
        maxHeight: input.width ?? 160,
        maxBytes: 48 * 1024,
      },
    );
    if (!image) throw new Error("无法生成图片缩略图。");
    return {
      kind: "image",
      width: metadata.width,
      height: metadata.pageHeight ?? metadata.height,
      frames: metadata.pages ?? 1,
      thumbnail: `data:${image.mimeType};base64,${image.data}`,
    };
  }
  await inspectZip(input.path);
  const bytes = await readFile(input.path);
  const catalog = XLSX.read(bytes, { bookSheets: true });
  const sheet = input.sheet ?? catalog.SheetNames[0];
  if (!catalog.SheetNames.includes(sheet)) throw new Error("工作表不存在。");
  const book = XLSX.read(bytes, {
    sheets: sheet,
    sheetRows: PREVIEW_ROWS,
    dense: true,
    cellFormula: false,
    cellHTML: false,
  });
  const cells = book.Sheets[sheet];
  const range = cells["!ref"]
    ? XLSX.utils.decode_range(cells["!ref"])
    : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  range.s = { r: 0, c: 0 };
  range.e.r = Math.min(range.e.r, PREVIEW_ROWS - 1);
  range.e.c = Math.min(range.e.c, PREVIEW_COLUMNS - 1);
  const rows = XLSX.utils.sheet_to_json(cells, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
    range,
  });
  return {
    kind: "xlsx",
    sheets: catalog.SheetNames,
    sheet,
    rows,
    rowLimit: PREVIEW_ROWS,
    columnLimit: PREVIEW_COLUMNS,
  };
}

process.once("message", async (input) => {
  try {
    process.send?.({ result: await preview(input) });
  } catch (error) {
    process.send?.({
      error: error instanceof Error ? error.message : "无法预览此文件。",
    });
  } finally {
    process.disconnect();
  }
});
