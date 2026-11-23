import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { BlockList, isIP } from "node:net";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { Agent, request } from "undici";
import type { FilePreviews } from "./file-previews.ts";

export type LinkPreview = {
  status: "ready" | "empty" | "failed" | "blocked";
  error?: string;
  title?: string;
  description?: string;
  thumbnail?: string;
};

class PreviewBlocked extends Error {}

function failure(error: unknown): LinkPreview {
  const blocked =
    error instanceof PreviewBlocked ||
    (error instanceof Error && error.cause instanceof PreviewBlocked);
  return {
    status: blocked ? "blocked" : "failed",
    error: blocked ? "预览地址被安全规则拦截。" : "暂时无法读取网页预览。",
  };
}

export function linkUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("链接必须使用 HTTPS，且不能包含登录凭据。");
  return url;
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}

const resolver = new Agent({
  connect: {
    timeout: 5000,
    // Pin the resolver so synthetic system DNS cannot redirect this request.
    lookup(_hostname, options, callback) {
      if (options.all) callback(null, [{ address: "1.1.1.1", family: 4 }]);
      else callback(null, "1.1.1.1", 4);
    },
  },
});

async function readBytes(
  body: AsyncIterable<Buffer>,
  limit: number,
  head = false,
) {
  const chunks: Buffer[] = [];
  let size = 0;
  let tail = "";
  for await (const chunk of body) {
    size += chunk.length;
    if (size > limit) throw new Error("预览超过大小限制。");
    chunks.push(Buffer.from(chunk));
    if (head) {
      const text = tail + chunk.toString("utf8");
      if (/<\/head\s*>/i.test(text)) break;
      tail = text.slice(-32);
    }
  }
  return Buffer.concat(chunks);
}

async function publicDns(hostname: string) {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", "A");
  const response = await request(url, {
    dispatcher: resolver,
    signal: AbortSignal.timeout(5000),
    headersTimeout: 5000,
    bodyTimeout: 5000,
    headers: { accept: "application/dns-json" },
  });
  try {
    if (response.statusCode !== 200) throw new Error("域名解析失败。");
    const result = JSON.parse(
      (await readBytes(response.body, 64 * 1024)).toString("utf8"),
    ) as {
      Status: number;
      Answer?: { type: number; data: string }[];
    };
    const addresses = (result.Answer ?? [])
      .filter((answer) => answer.type === 1)
      .map((answer) => ({ address: answer.data, family: 4 }));
    if (result.Status !== 0 || !addresses.length)
      throw new Error("域名解析失败。");
    if (addresses.some(({ address }) => !publicAddress(address)))
      throw new PreviewBlocked("预览地址不可访问。");
    return addresses;
  } finally {
    const closed = finished(response.body, { cleanup: true });
    response.body.destroy();
    await closed.catch(() => {});
  }
}

const synthetic = new BlockList();
synthetic.addSubnet("198.18.0.0", 15, "ipv4");
const dispatcher = new Agent({
  connections: 2,
  connect: {
    timeout: 5000,
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true }, (error, addresses) => {
        if (error) return callback(error, [], undefined);
        const resolved =
          !isIP(hostname) &&
          addresses.length &&
          addresses.every(
            ({ address }) =>
              isIP(address) === 4 && synthetic.check(address, "ipv4"),
          )
            ? publicDns(hostname)
            : Promise.resolve(addresses);
        void resolved
          .then((checked) => {
            const first = checked[0];
            if (
              !first ||
              checked.some(({ address }) => !publicAddress(address))
            )
              throw new PreviewBlocked("预览地址不可访问。");
            // Return the checked addresses to the socket without a second DNS read.
            if (options.all) callback(null, checked);
            else callback(null, first.address, first.family);
          })
          .catch((error) => callback(error, [], undefined));
      });
    },
  },
});

async function readPublic(
  value: string,
  limit: number,
  signal: AbortSignal,
  image: boolean,
) {
  let url = linkUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (
      (isIP(hostname) && !publicAddress(hostname)) ||
      (url.port && url.port !== "443")
    )
      throw new PreviewBlocked("预览地址不可访问。");
    const response = await request(url, {
      dispatcher,
      signal,
      headersTimeout: 5000,
      bodyTimeout: 5000,
      headers: {
        accept: image
          ? "image/png,image/jpeg,image/webp,image/gif"
          : "text/html",
        "accept-encoding": "identity",
      },
    });
    try {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        if (typeof location !== "string") throw new Error("预览重定向无效。");
        url = linkUrl(new URL(location, url).href);
        continue;
      }
      const type = (
        String(response.headers["content-type"] ?? "").split(";")[0] ?? ""
      )
        .trim()
        .toLowerCase();
      if (
        response.statusCode !== 200 ||
        (image
          ? !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
              type,
            )
          : !["text/html", "application/xhtml+xml"].includes(type))
      )
        throw new Error("无法读取网页预览。");
      if (image && Number(response.headers["content-length"]) > limit)
        throw new Error("预览超过大小限制。");
      return {
        bytes: await readBytes(response.body, limit, !image),
        type,
        url,
      };
    } finally {
      const closed = finished(response.body, { cleanup: true });
      response.body.destroy();
      await closed.catch(() => {});
    }
  }
  throw new Error("预览重定向过多。");
}

function decode(value: string) {
  return value
    .replace(
      /&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,
      (match, entity: string) => {
        const named: Record<string, string> = {
          amp: "&",
          quot: '"',
          apos: "'",
          lt: "<",
          gt: ">",
        };
        if (!entity.startsWith("#"))
          return named[entity.toLowerCase()] ?? match;
        const point =
          entity.charAt(1).toLowerCase() === "x"
            ? Number.parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return point > 0 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : "";
      },
    )
    .trim();
}

export function linkMetadata(html: string, url: string) {
  const head = (html.split(/<\/head\s*>/i)[0] ?? html).replace(
    /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
    "",
  );
  const metadata = new Map<string, string>();
  for (const tag of head.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(
      /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
    ))
      attributes.set(
        (match[1] ?? "").toLowerCase(),
        decode(match[2] ?? match[3] ?? match[4] ?? ""),
      );
    const name = (
      attributes.get("property") ?? attributes.get("name")
    )?.toLowerCase();
    if (name && !metadata.has(name))
      metadata.set(name, attributes.get("content") ?? "");
  }
  let image: string | undefined;
  try {
    const value = metadata.get("og:image") ?? metadata.get("twitter:image");
    if (value) {
      const target = new URL(value, url);
      if (target.protocol === "http:") target.protocol = "https:";
      image = linkUrl(target.href).href;
    }
  } catch {}
  return {
    title:
      (
        metadata.get("og:title") ||
        decode(head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "")
      ).slice(0, 256) || undefined,
    description:
      (metadata.get("og:description") || metadata.get("description"))?.slice(
        0,
        2000,
      ) || undefined,
    image,
  };
}

export class LinkPreviews {
  private readonly root: string;
  private readonly images: FilePreviews;
  private readonly pending = new Map<
    string,
    {
      promise: Promise<LinkPreview>;
      controller: AbortController;
      readers: number;
    }
  >();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(root: string, images: FilePreviews) {
    this.root = root;
    this.images = images;
  }

  clear() {
    const clearing = this.queue
      .catch(() => {})
      .then(async () => {
        const path = join(this.root, "link-previews");
        await rm(path, { recursive: true, force: true });
      });
    this.queue = clearing;
    return clearing;
  }

  async read(
    botId: number,
    value: string,
    signal?: AbortSignal,
  ): Promise<LinkPreview> {
    const url = linkUrl(value).href;
    const key = createHash("sha256")
      .update(JSON.stringify([botId, url, 2]))
      .digest("hex");
    const directory = join(this.root, "link-previews");
    const path = join(directory, `${key}.json`);
    signal?.throwIfAborted();
    const cached = await readFile(path, "utf8")
      .then((text) => JSON.parse(text) as { at: number; preview: LinkPreview })
      .catch(() => null);
    signal?.throwIfAborted();
    if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000)
      return cached.preview;
    let pending = this.pending.get(key);
    if (pending?.controller.signal.aborted) pending = undefined;
    if (!pending) {
      const controller = new AbortController();
      const promise = this.queue
        .catch(() => {})
        .then(async () => {
          controller.signal.throwIfAborted();
          const bounded = AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]);
          const preview = await this.generate(url, bounded).catch((error) => {
            controller.signal.throwIfAborted();
            return failure(error);
          });
          controller.signal.throwIfAborted();
          if (preview.status === "failed" || preview.status === "blocked")
            return preview;
          await mkdir(directory, { recursive: true });
          const temporary = `${path}.${randomUUID()}.tmp`;
          try {
            await writeFile(
              temporary,
              JSON.stringify({ at: Date.now(), preview }),
            );
            await rename(temporary, path);
          } finally {
            await rm(temporary, { force: true });
          }
          const entries = await Promise.all(
            (await readdir(directory))
              .filter((name) => name.endsWith(".json"))
              .map(async (name) => ({
                path: join(directory, name),
                at: (await stat(join(directory, name))).mtimeMs,
              })),
          );
          for (const entry of entries.sort((a, b) => b.at - a.at).slice(100))
            await rm(entry.path, { force: true });
          return preview;
        });
      pending = { promise, controller, readers: 0 };
      this.pending.set(key, pending);
      this.queue = promise;
      void promise
        .finally(() => {
          if (this.pending.get(key)?.promise === promise)
            this.pending.delete(key);
        })
        .catch(() => {});
    }
    const current = pending;
    current.readers++;
    let release = () => {};
    try {
      return await Promise.race([
        current.promise,
        new Promise<never>((_, reject) => {
          const abort = () =>
            reject(signal?.reason ?? new Error("预览已取消。"));
          signal?.addEventListener("abort", abort, { once: true });
          release = () => signal?.removeEventListener("abort", abort);
          if (signal?.aborted) abort();
        }),
      ]);
    } finally {
      release();
      if (--current.readers === 0 && this.pending.get(key) === current)
        current.controller.abort();
    }
  }

  private async generate(
    url: string,
    signal: AbortSignal,
  ): Promise<LinkPreview> {
    const page = await readPublic(url, 512 * 1024, signal, false);
    const { image, ...metadata } = linkMetadata(
      page.bytes.toString("utf8"),
      page.url.href,
    );
    if (!image) return { ...metadata, status: "empty" };
    const directory = join(this.root, ".incoming", randomUUID());
    try {
      const cover = await readPublic(image, 5 * 1024 * 1024, signal, true);
      await mkdir(directory, { recursive: true });
      const path = join(directory, "cover");
      await writeFile(path, cover.bytes);
      const id = createHash("sha256").update(cover.bytes).digest("hex");
      const result = await this.images.read(
        {
          id,
          path,
          name: "cover",
          size: cover.bytes.length,
          mimeType: cover.type,
        },
        path,
        undefined,
        signal,
        640,
      );
      return {
        ...metadata,
        ...(result.kind === "image"
          ? { status: "ready", thumbnail: result.thumbnail }
          : { status: "failed", error: "无法生成网页封面。" }),
      };
    } catch (error) {
      signal.throwIfAborted();
      return { ...metadata, ...failure(error) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
