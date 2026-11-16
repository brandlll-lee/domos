import { open } from "node:fs/promises";
import sharp from "sharp";

const MAX_PIXELS = 16 * 1024 * 1024;

// Only erase colour-connected background; enclosed details belong to the subject.
export function removeBackground(data, width, height, key, tolerance = 65) {
  const count = width * height;
  const seen = new Uint8Array(count);
  const queue = new Uint32Array(count);
  let head = 0;
  let tail = 0;
  const distance = (pixel) => {
    const offset = pixel * 4;
    return Math.hypot(...key.map((value, i) => data[offset + i] - value));
  };
  const visit = (pixel) => {
    if (!seen[pixel] && distance(pixel) < tolerance) {
      seen[pixel] = 1;
      queue[tail++] = pixel;
    }
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (head < tail) {
    const pixel = queue[head++];
    if (pixel % width) visit(pixel - 1);
    if (pixel % width < width - 1) visit(pixel + 1);
    if (pixel >= width) visit(pixel - width);
    if (pixel < count - width) visit(pixel + width);
  }
  const edge = seen.slice();
  for (let radius = 0; radius < 2; radius++) {
    const previous = edge.slice();
    for (let p = 0; p < count; p++) {
      if (previous[p]) continue;
      if (
        (p % width && previous[p - 1]) ||
        (p % width < width - 1 && previous[p + 1]) ||
        (p >= width && previous[p - width]) ||
        (p < count - width && previous[p + width])
      )
        edge[p] = 1;
    }
  }
  for (let p = 0; p < count; p++) {
    const offset = p * 4;
    if (seen[p]) data[offset + 3] = 0;
    else if (edge[p]) {
      const alpha = Math.min(1, Math.max(0, (distance(p) - 25) / 100));
      data[offset + 3] = Math.round(data[offset + 3] * alpha);
      if (alpha > 0 && alpha < 1)
        for (let i = 0; i < 3; i++)
          data[offset + i] = Math.max(
            0,
            Math.min(255, (data[offset + i] - key[i] * (1 - alpha)) / alpha),
          );
    }
  }
  if (tail < count * 0.01 || tail > count * 0.98)
    throw new Error("背景识别不可靠，原始文件已保留。请换背景色或调整构图。");
  return data;
}

export async function prepareImage(path, output, transparent = false) {
  const file = await open(path, "r");
  const signature = Buffer.alloc(12);
  try {
    await file.read(signature, 0, 12, 0);
  } finally {
    await file.close();
  }
  if (
    !(
      signature
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      signature.subarray(0, 3).toString() === "GIF" ||
      signature.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
      (signature.subarray(0, 4).toString() === "RIFF" &&
        signature.subarray(8, 12).toString() === "WEBP")
    )
  )
    throw new Error("服务未返回支持的 PNG、JPEG、GIF 或 WebP 文件。");
  const image = sharp(path, { animated: true, limitInputPixels: MAX_PIXELS });
  const metadata = await image.metadata();
  const frames = metadata.pages ?? 1;
  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  if (!width || !height || frames > 16 || width * height * frames > MAX_PIXELS)
    throw new Error("图片尺寸或帧数超过处理预算。");
  const delay = metadata.delay ?? [];
  const result = { width, height, frames, delay, format: metadata.format };
  if (!transparent) return result;
  const { data } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = width * height * 4;
  // Use one key for the entire clip to avoid per-frame colour flicker.
  const border = [[], [], []];
  for (let x = 0; x < width; x++)
    for (const y of [0, height - 1])
      for (let c = 0; c < 3; c++) border[c].push(data[(y * width + x) * 4 + c]);
  const key = border.map(
    (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)],
  );
  for (let frame = 0; frame < frames; frame++) {
    const pixels = data.subarray(frame * stride, (frame + 1) * stride);
    // Native transparent PNG/WebP does not require colour-key removal.
    if (
      !metadata.hasAlpha ||
      pixels.every((value, i) => i % 4 !== 3 || value === 255)
    )
      removeBackground(pixels, width, height, key);
    let clear = 0,
      subject = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] === 0) clear++;
      if (pixels[i] > 0) subject++;
    }
    if (clear < width * height * 0.01 || subject < width * height * 0.02)
      throw new Error("透明处理未得到可靠背景或非空主体；原始文件已保留。");
  }
  await sharp(data, {
    raw: { width, height: height * frames, channels: 4, pageHeight: height },
  })
    .webp({ lossless: true, loop: metadata.loop ?? 0, delay })
    .toFile(output);
  return { ...result, format: "webp" };
}
