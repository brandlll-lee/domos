import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { FilePreviews } from "../src/file-previews.ts";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  lookup: vi.fn(),
  connect: undefined as
    | {
        lookup: (
          host: string,
          options: { all: boolean },
          callback: (...args: unknown[]) => void,
        ) => void;
      }
    | undefined,
}));
vi.mock("undici", () => ({
  request: mocks.request,
  Agent: class {
    constructor(options: { connect: NonNullable<typeof mocks.connect> }) {
      mocks.connect = options.connect;
    }
  },
}));
vi.mock("node:dns", () => ({ lookup: mocks.lookup }));

import {
  LinkPreviews,
  linkMetadata,
  linkUrl,
  publicAddress,
} from "../src/link-previews.ts";

const directories: string[] = [];
afterEach(async () => {
  mocks.request.mockReset();
  mocks.lookup.mockReset();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
function response(
  body: string | Buffer,
  type = "text/html",
  statusCode = 200,
  headers = {},
) {
  return {
    statusCode,
    headers: { "content-type": type, ...headers },
    body: Object.assign(
      (async function* () {
        yield Buffer.from(body);
      })(),
      { destroy: vi.fn() },
    ),
  };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "domos-link-preview-"));
  directories.push(root);
  const read = vi.fn().mockResolvedValue({
    kind: "image",
    thumbnail: "data:image/png;base64,aW1hZ2U=",
  });
  return {
    root,
    read,
    previews: new LinkPreviews(root, { read } as unknown as FilePreviews),
  };
}

test("link targets accept HTTPS and keep the original destination", () => {
  expect(linkUrl("https://example.com/report?version=2#results").href).toBe(
    "https://example.com/report?version=2#results",
  );
  for (const url of [
    "http://example.com",
    "javascript:alert(1)",
    "file:///C:/test",
    "https://user:pass@example.com",
    "text",
  ])
    expect(() => linkUrl(url)).toThrow();
});

test("preview address policy excludes local and reserved IPv4 and IPv6", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.1.1",
    "172.20.1.1",
    "192.168.1.2",
    "169.254.169.254",
    "100.100.100.200",
    "0.0.0.0",
    "224.0.0.1",
    "198.18.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "invalid",
  ])
    expect(publicAddress(address), address).toBe(false);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    expect(publicAddress(address), address).toBe(true);
});

test("socket DNS uses only the checked addresses, including fallback addresses", async () => {
  const connect = mocks.connect;
  if (!connect) throw new Error("Preview connector required");
  const callback = vi.fn();
  mocks.lookup.mockImplementation((_host, _options, done) =>
    done(null, [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
  );
  connect.lookup("example.com", { all: true }, callback);
  expect(callback.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  callback.mockClear();
  mocks.lookup.mockImplementation((_host, _options, done) =>
    done(null, [{ address: "8.8.8.8", family: 4 }]),
  );
  connect.lookup("example.com", { all: false }, callback);
  expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  expect(mocks.lookup).toHaveBeenCalledTimes(2);
});

test("metadata reads quoted and unquoted attributes as text and keeps the first Open Graph image", () => {
  const metadata = linkMetadata(
    `<head><title>Fallback &amp; name</title><!-- <meta property="og:title" content="Comment"> --><script>"<meta property='og:title' content='Script'>"</script><meta content='Report &#x1F44B;' property='og:title'><meta property=og:image content='/cover.png?x=1&amp;y=2'><meta property="og:image" content="/other.png"><meta NAME="description" content="Some &quot;text&quot;"></head><meta property="og:title" content="Body">`,
    "https://example.com/docs/page",
  );
  expect(metadata).toEqual({
    title: "Report 👋",
    description: 'Some "text"',
    image: "https://example.com/cover.png?x=1&y=2",
  });
  expect(
    linkMetadata(
      '<title>Fallback &amp; name</title><meta property="og:image" content="javascript:alert(1)">',
      "https://example.com",
    ),
  ).toEqual({
    title: "Fallback & name",
    description: undefined,
    image: undefined,
  });
});

test("previews share pending reads, retain metadata and cache the bounded Files thumbnail", async () => {
  const { root, read, previews } = await fixture();
  mocks.request.mockImplementation(async (url: URL) =>
    url.pathname === "/cover.png"
      ? response("image", "image/png")
      : response(
          '<meta property="og:title" content="Web title"><meta property="og:description" content="Web body"><meta property="og:image" content="/cover.png">',
        ),
  );
  const first = previews.read(1, "https://example.com/report");
  const second = previews.read(1, "https://example.com/report");
  expect(await first).toEqual(await second);
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0]?.[4]).toBe(640);
  expect(mocks.request).toHaveBeenCalledTimes(2);
  const restarted = new LinkPreviews(root, { read } as unknown as FilePreviews);
  expect(await restarted.read(1, "https://example.com/report")).toMatchObject({
    title: "Web title",
    thumbnail: expect.stringContaining("data:image/png"),
  });
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(await readdir(join(root, ".incoming"))).toEqual([]);
  await restarted.read(2, "https://example.com/report");
  expect(mocks.request).toHaveBeenCalledTimes(4);
});

test("private targets and redirects cannot fetch a preview", async () => {
  const { previews } = await fixture();
  expect(await previews.read(1, "https://127.0.0.1/secret")).toEqual({});
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.request.mockResolvedValue(
    response("", "text/html", 302, { location: "https://[::1]/secret" }),
  );
  expect(await previews.read(1, "https://example.com/redirect")).toEqual({});
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request.mock.calls[0]?.[1].headers).not.toHaveProperty("cookie");
  expect(mocks.request.mock.calls[0]?.[1].headers).not.toHaveProperty(
    "authorization",
  );
});

test("oversize pages stop at the byte budget and blocked images retain page text", async () => {
  const { previews, read } = await fixture();
  mocks.request.mockResolvedValue(response("x".repeat(512 * 1024 + 1)));
  expect(await previews.read(1, "https://example.com/large")).toEqual({});
  mocks.request.mockResolvedValue(
    response(
      '<meta property="og:title" content="Good title"><meta property="og:image" content="https://10.0.0.1/picture">',
    ),
  );
  expect(await previews.read(1, "https://example.com/safe")).toEqual({
    title: "Good title",
    description: undefined,
  });
  expect(read).not.toHaveBeenCalled();
});

test("cancellation stops the last reader and does not publish a cached failure", async () => {
  const { previews } = await fixture();
  const started = Promise.withResolvers<void>();
  mocks.request.mockImplementation(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        started.resolve();
      }),
  );
  const controller = new AbortController();
  const pending = previews.read(
    1,
    "https://example.com/cancel",
    controller.signal,
  );
  const assertion = expect(pending).rejects.toThrow();
  await started.promise;
  controller.abort();
  await assertion;
  mocks.request.mockResolvedValue(response("<title>Recovered</title>"));
  expect(await previews.read(1, "https://example.com/cancel")).toMatchObject({
    title: "Recovered",
  });
});
