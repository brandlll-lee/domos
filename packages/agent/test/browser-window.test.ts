import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

const entry = "../src/harness/browser-window.mjs";
const { browserProcess, browserPagePoint } = await import(entry);
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("browser identity comes from the owned profile endpoint", async () => {
  const profile = await mkdtemp(join(tmpdir(), "domos-browser-identity-"));
  directories.push(profile);
  await writeFile(
    join(profile, "DevToolsActivePort"),
    "9222\n/devtools/browser/owned\n",
  );
  let closed = false;
  class Socket extends EventTarget {
    constructor(url: string) {
      super();
      expect(url).toBe("ws://127.0.0.1:9222/devtools/browser/owned");
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(value: string) {
      expect(JSON.parse(value)).toEqual({
        id: 1,
        method: "SystemInfo.getProcessInfo",
      });
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            id: 1,
            result: {
              processInfo: [
                { type: "renderer", id: 4 },
                { type: "browser", id: 9 },
              ],
            },
          }),
        }),
      );
    }
    close() {
      closed = true;
      this.dispatchEvent(new Event("close"));
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  expect(await browserProcess(profile, AbortSignal.timeout(1000))).toBe(9);
  expect(closed).toBe(true);
  await writeFile(
    join(profile, "DevToolsActivePort"),
    "70000\n/devtools/browser/owned\n",
  );
  await expect(
    browserProcess(profile, AbortSignal.timeout(1000)),
  ).rejects.toThrow("身份未确认");
});

test("page hover maps window pixels and excludes native browser controls", () => {
  const window = {
    width: 1050,
    height: 798,
    innerWidth: 1034,
    innerHeight: 646,
  };
  expect(
    browserPagePoint(window, { width: 525, height: 399 }, 54, 122),
  ).toEqual({ x: 100, y: 100 });
  expect(
    browserPagePoint(window, { width: 525, height: 399 }, 54, 20),
  ).toBeUndefined();
  expect(() =>
    browserPagePoint(window, { width: 0, height: 399 }, 54, 20),
  ).toThrow("尺寸未确认");
});
