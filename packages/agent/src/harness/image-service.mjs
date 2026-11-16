import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import sharp from "sharp";
import { prepareImage } from "./image-processing.mjs";

const MAX_BYTES = 32 * 1024 * 1024;
const models = ["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"];

function redact(value, key) {
  let text = String(value);
  if (key)
    for (const secret of [
      key,
      JSON.stringify(key).slice(1, -1),
      encodeURIComponent(key),
    ])
      text = text.replaceAll(secret, "[REDACTED]");
  return text
    .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
    .replace(
      /(api[_-]?key|authorization|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s"'<>;,}]+/gi,
      "$1$2[REDACTED]",
    )
    .replace(/sk-[\w-]+/g, "[REDACTED]");
}

function requestFailure(info) {
  return Object.assign(new Error(info.message), { imageRequest: info });
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function providerFailure(response, key) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      chunks.push(chunk.subarray(0, 16384 - size));
      size += chunk.length;
      if (size >= 16384) break;
    }
  } catch {
    // Keep the received HTTP status when the error body cannot be read.
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let body;
  try {
    body = JSON.parse(text);
  } catch {}
  const source = body?.error ?? body;
  const provider = {};
  for (const field of ["message", "code", "param", "type"])
    if (["string", "number"].includes(typeof source?.[field]))
      provider[field] = redact(source[field], key).slice(0, 2048);
  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    body?.request_id;
  if (typeof requestId === "string")
    provider.requestId = redact(requestId, key).slice(0, 512);
  provider.message ??= redact(
    body ? "服务未提供错误说明。" : text || "服务返回空错误正文。",
    key,
  ).slice(0, 4096);
  return requestFailure({
    outcome:
      response.status >= 400 && response.status < 500 && response.status !== 408
        ? "rejected"
        : "unknown",
    originalsAvailable: false,
    httpStatus: response.status,
    provider,
    message: `图像服务 HTTP ${response.status}：${provider.message}`,
  });
}

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
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      handle = await open(lock, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      break;
    } catch (error) {
      // Windows may retain a deleted lock handle briefly after cancellation.
      if (error.code === "EPERM" && attempt < 9) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }
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
  } catch (error) {
    if (error.imageRequest || input.action === "image_test") throw error;
    const id = createHash("sha256").update(input.requestId).digest("hex");
    const directory = join(root, id);
    const saved = await readJson(join(directory, "originals.json"));
    const intent = await readJson(join(directory, "intent.json"));
    const files = await Promise.all(
      (saved?.files ?? []).map((path) =>
        lstat(path).then(
          (info) => info.isFile(),
          () => false,
        ),
      ),
    );
    throw requestFailure({
      outcome: saved ? "generated" : intent ? "unknown" : "not_sent",
      originalsAvailable: files.length > 0 && files.every(Boolean),
      message:
        error.code === "ENOENT"
          ? "保留的图片文件不存在。"
          : redact(error.message, input.key),
    });
  } finally {
    await handle.close();
    await rm(lock, { force: true });
  }
}

async function relativeResult(saved, id) {
  const root = process.cwd();
  const output = join(root, ".domos-generated", id);
  const files = [];
  for (const item of saved.files) {
    const result = { ...item };
    for (const part of ["original", "path", "cover"]) {
      const source = isAbsolute(item[part])
        ? item[part]
        : join(root, item[part]);
      const sourceInfo = await lstat(source);
      if (
        sourceInfo.isSymbolicLink() ||
        (sourceInfo.isFile() && sourceInfo.nlink > 1)
      )
        throw new Error("图像输出不能经过链接。");
      const actual = await realpath(source);
      const local = relative(output, actual);
      if (!local || local === ".." || local.includes(sep) || isAbsolute(local))
        throw new Error("已保存图像不在原请求的输出目录。");
      for (const segment of [
        ".domos-generated",
        join(".domos-generated", id),
        relative(root, actual),
      ]) {
        const info = await lstat(join(root, segment));
        if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1))
          throw new Error("图像输出不能经过链接。");
      }
      result[part] = relative(root, actual).split(sep).join("/");
    }
    files.push(result);
  }
  return { ...saved, files };
}

async function operation(input, home, signal) {
  if (input.action === "image_recover") {
    const id = createHash("sha256").update(input.requestId).digest("hex");
    const directory = join(home, "image-requests", id);
    try {
      return await relativeResult(
        JSON.parse(await readFile(join(directory, "result.json"), "utf8")),
        id,
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const saved = await readJson(join(directory, "originals.json"));
    if (!saved) {
      const intent = await readJson(join(directory, "intent.json"));
      if (intent?.failure) throw requestFailure(intent.failure);
      throw requestFailure({
        outcome: intent ? "unknown" : "not_sent",
        originalsAvailable: false,
        message: intent
          ? "没有保留图片。原请求结果未知。"
          : "没有此请求的生成记录或保留图片。",
      });
    }
    if (!saved.processing || saved.directory !== process.cwd())
      throw new Error("原始结果缺少处理上下文，不能自动重生成。");
    const validated = await relativeResult(
      {
        files: saved.files.map((original) => ({
          original,
          path: original,
          cover: original,
        })),
      },
      id,
    );
    return finishImages(
      saved.processing,
      validated.files.map((item) => join(process.cwd(), item.original)),
      join(process.cwd(), ".domos-generated", id),
      join(directory, "result.json"),
      saved.fingerprint,
      id,
      signal,
    );
  }
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
      throw await providerFailure(response, input.key);
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
    .update(JSON.stringify({ params, baseUrl: base, directory: process.cwd() }))
    .digest("hex");
  const manifest = join(directory, "result.json");
  const intentPath = join(directory, "intent.json");
  const intent = await readJson(intentPath);
  if (intent && intent.fingerprint !== fingerprint)
    throw new Error("请求标识冲突。");
  if (intent?.failure) throw requestFailure(intent.failure);
  try {
    const saved = JSON.parse(await readFile(manifest, "utf8"));
    if (saved.fingerprint !== fingerprint)
      throw new Error(
        "请求标识或原工作目录、服务地址不一致。请恢复原上下文读取保留结果；不会重新收费生成。",
      );
    return relativeResult(saved, id);
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
    if (intent)
      throw new Error("此前生图请求已发出但结果未知；不会自动再次收费生成。");
    let keyColor = params.keyColor ?? "bright blue";
    if (
      params.purpose === "avatar" &&
      params.transparent &&
      params.format === "gif" &&
      !params.keyColor &&
      params.references?.length
    ) {
      const candidates = [
        { name: "pure blue (#0000ff)", rgb: [0, 0, 255], hits: 0 },
        { name: "pure magenta (#ff00ff)", rgb: [255, 0, 255], hits: 0 },
        { name: "pure green (#00ff00)", rgb: [0, 255, 0], hits: 0 },
      ];
      for (const reference of params.references) {
        const bytes = Buffer.from(
          reference.slice(reference.indexOf(",") + 1),
          "base64",
        );
        const sample = await sharp(bytes, {
          limitInputPixels: 16 * 1024 * 1024,
        })
          .resize(32, 32, { fit: "inside" })
          .removeAlpha()
          .toColourspace("srgb")
          .raw()
          .toBuffer();
        for (let i = 0; i < sample.length; i += 3)
          for (const candidate of candidates)
            if (
              Math.hypot(...candidate.rgb.map((v, c) => v - sample[i + c])) <
              100
            )
              candidate.hits++;
      }
      keyColor = candidates.sort((a, b) => a.hits - b.hits)[0].name;
    }
    const prompt =
      params.transparent && params.format === "gif"
        ? `${params.prompt}\nUse a perfectly uniform ${keyColor} background, no gradient or shadows. Keep the entire character inside the canvas, fixed camera and stable head position, generous clear border, seamless loop. The background colour must differ from all foreground colours.`
        : `${params.prompt}${params.purpose === "avatar" ? " Avatar composition: entire subject inside canvas, fixed camera, stable head, generous clear border. Structured background and animation settings override conflicting prompt instructions." : ""}`;
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
    await writeFile(intentPath, JSON.stringify({ fingerprint }), {
      flag: "wx",
      mode: 0o600,
    });
    const response = await request(
      params.references?.length ? "images/edits" : "images/generations",
      body,
    ).catch(async (error) => {
      if (error.imageRequest)
        await saveJson(intentPath, {
          fingerprint,
          failure: error.imageRequest,
        });
      throw error;
    });
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
    await saveJson(rawManifest, {
      fingerprint,
      files: originals,
      directory: process.cwd(),
      processing: {
        format: params.format,
        frames: params.frames,
        frameDurationMs: params.frameDurationMs,
        transparent: !!params.transparent,
        purpose: params.purpose ?? "image",
      },
    });
  }
  return finishImages(
    params,
    originals,
    outputDirectory,
    manifest,
    fingerprint,
    id,
    signal,
  );
}
async function finishImages(
  params,
  originals,
  outputDirectory,
  manifest,
  fingerprint,
  id,
  signal,
) {
  const files = [];
  for (const [index, original] of originals.entries()) {
    signal.throwIfAborted();
    const output = join(outputDirectory, `${index}.webp`);
    const source = await prepareImage(original);
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
      preparation: {
        purpose: params.purpose ?? "image",
        status: "ready",
        transparent: !!params.transparent,
        animated: info.frames > 1,
      },
    });
  }
  signal.throwIfAborted();
  const result = { fingerprint, files };
  await saveJson(manifest, result);
  return relativeResult(result, id);
}
