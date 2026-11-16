import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { prepareImage } from "./image-processing.mjs";

const MAX_BYTES = 32 * 1024 * 1024;
const models = ["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"];

export function imageBaseUrl(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("图像服务地址无效。");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("图像服务需要 HTTPS；本机地址可以使用 HTTP。");
  return url.href.replace(/\/+$/, "");
}

async function boundedResponse(response) {
  const chunks = [];
  let size = 0;
  if (!response.body) throw new Error("图像服务返回为空。");
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("图像服务响应超过预算。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function saveJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

export async function imageOperation(input, home, signal) {
  const root = join(home, "image-requests");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = join(root, "active.lock");
  let handle;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      handle = await open(lock, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let pid;
      try {
        pid = Number(await readFile(lock, "utf8"));
      } catch (failure) {
        if (failure.code === "ENOENT") continue;
        throw failure;
      }
      try {
        process.kill(pid, 0);
      } catch (failure) {
        if (failure.code === "ESRCH") {
          await rm(lock, { force: true });
          continue;
        }
      }
      throw new Error("工作电脑已有图像操作正在运行，请稍后重试。");
    }
  }
  if (!handle) throw new Error("图像操作正在恢复，请稍后重试。");
  sharp.cache(false);
  sharp.concurrency(1);
  try {
    signal.throwIfAborted();
    return await operation(input, home, signal);
  } finally {
    await handle.close();
    await rm(lock, { force: true });
  }
}

async function operation(input, home, signal) {
  const base = imageBaseUrl(input.baseUrl);
  const request = async (path, body) => {
    const response = await fetch(`${base}/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${input.key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `图像服务 HTTP ${response.status}：${response.status === 401 ? "认证失败" : response.status === 403 ? "权限或额度不足" : response.status === 429 ? "额度或并发限制" : "请求未完成"}。`,
      );
    }
    return JSON.parse((await boundedResponse(response)).toString("utf8"));
  };
  if (input.action === "image_test") {
    const result = await request("models");
    return {
      models: models.filter((model) =>
        result.data?.some((item) => item.id === model),
      ),
      gifVerified: false,
    };
  }
  const params = input.params;
  if (
    !models.includes(params.model) ||
    !["png", "webp", "gif"].includes(params.format) ||
    !Number.isInteger(params.count) ||
    params.count < 1 ||
    params.count > 4 ||
    typeof params.prompt !== "string" ||
    !params.prompt.trim() ||
    params.prompt.length > 32000
  )
    throw new Error("生图参数无效。");
  if (
    params.format === "gif" &&
    (!Number.isInteger(params.frames) ||
      params.frames < 2 ||
      params.frames > 16 ||
      !Number.isInteger(params.frameDurationMs) ||
      params.frameDurationMs < 20 ||
      params.frameDurationMs > 2000)
  )
    throw new Error("GIF需要2–16帧，每帧20–2000毫秒。");
  const id = createHash("sha256").update(input.requestId).digest("hex");
  const directory = join(home, "image-requests", id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const outputDirectory = join(process.cwd(), ".domos-generated", id);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(params))
    .digest("hex");
  const manifest = join(directory, "result.json");
  try {
    const saved = JSON.parse(await readFile(manifest, "utf8"));
    if (saved.fingerprint !== fingerprint)
      throw new Error("请求标识已用于其他生图内容。");
    return saved;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const rawManifest = join(directory, "originals.json");
  let originals;
  try {
    const saved = JSON.parse(await readFile(rawManifest, "utf8"));
    if (saved.fingerprint !== fingerprint) throw new Error("请求标识冲突。");
    originals = saved.files;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      await writeFile(
        join(directory, "intent.json"),
        JSON.stringify({ fingerprint }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if (error.code === "EEXIST")
        throw new Error("此前生图请求已发出但结果未知；不会自动再次收费生成。");
      throw error;
    }
    const prompt =
      params.transparent && params.format === "gif"
        ? `${params.prompt}\nUse a perfectly uniform ${params.keyColor ?? "bright blue"} background, no gradient or shadows. Keep the entire character inside the canvas, fixed camera and stable head position, generous clear border, seamless loop. The background colour must differ from all foreground colours.`
        : params.prompt;
    const body = {
      model: params.model,
      prompt,
      n: params.count,
      output_format: params.format,
      quality: params.quality,
      complexity: params.complexity,
      ...(params.format === "gif"
        ? {
            frame_count: params.frames,
            frame_duration_ms: params.frameDurationMs,
          }
        : {}),
      ...(params.transparent && params.format !== "gif"
        ? { background: "transparent" }
        : {}),
      ...(params.references?.length
        ? { images: params.references.map((image_url) => ({ image_url })) }
        : {}),
    };
    const response = await request(
      params.references?.length ? "images/edits" : "images/generations",
      body,
    );
    if (
      !Array.isArray(response.data) ||
      !response.data.length ||
      response.data.length > 4
    )
      throw new Error("图像服务未返回有效文件。");
    originals = [];
    for (const [index, item] of response.data.entries()) {
      // Avoid forwarding credentials to arbitrary provider-returned download URLs.
      if (typeof item.b64_json !== "string" || item.b64_json.length > MAX_BYTES)
        throw new Error("服务需要返回有界的base64图片；下载URL暂不支持。");
      const bytes = Buffer.from(item.b64_json, "base64");
      const extension =
        bytes.subarray(0, 3).toString() === "GIF"
          ? "gif"
          : bytes[0] === 137
            ? "png"
            : bytes[0] === 255
              ? "jpg"
              : bytes.subarray(0, 4).toString() === "RIFF"
                ? "webp"
                : "bin";
      const path = join(outputDirectory, `${index}-original.${extension}`);
      await writeFile(path, bytes, { mode: 0o600 });
      originals.push(path);
    }
    await saveJson(rawManifest, { fingerprint, files: originals });
  }
  const files = [];
  for (const [index, original] of originals.entries()) {
    signal.throwIfAborted();
    const output = join(outputDirectory, `${index}.webp`);
    const source = await prepareImage(original);
    if (
      params.format === "gif" &&
      (source.format !== "gif" ||
        source.frames !== params.frames ||
        source.delay.length !== source.frames ||
        source.delay.some(
          (delay) => delay !== Math.round(params.frameDurationMs / 10) * 10,
        ))
    )
      throw new Error(
        "服务返回格式、帧数或时长不符；原始文件已保留，不会自动重生成。",
      );
    const info = params.transparent
      ? await prepareImage(original, output, true)
      : source;
    const cover = join(outputDirectory, `${index}-cover.png`);
    await sharp(params.transparent ? output : original, {
      limitInputPixels: 16 * 1024 * 1024,
    })
      .png()
      .toFile(cover);
    files.push({
      original,
      path: params.transparent ? output : original,
      cover,
      ...info,
    });
  }
  signal.throwIfAborted();
  const result = { fingerprint, files };
  await saveJson(manifest, result);
  return result;
}
