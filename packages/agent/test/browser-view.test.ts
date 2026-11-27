import { afterEach, expect, test, vi } from "vitest";

const command = vi.hoisted(() => vi.fn());
vi.mock("../src/harness/browser-command.mjs", () => ({
  browserCommand: command,
}));
const entry = "../src/harness/browser-view.mjs";
const { openBrowserView } = await import(entry);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

test("browser frames use the current CSS viewport after a headed restart and resize", async () => {
  let socket: EventTarget | undefined;
  vi.stubGlobal(
    "WebSocket",
    class extends EventTarget {
      constructor() {
        super();
        socket = this;
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }
      close() {}
      send() {}
    },
  );
  command.mockResolvedValueOnce({ session: "test" });
  const view = await openBrowserView(
    async () => JSON.stringify({ enabled: true, port: 9222 }),
    new AbortController().signal,
    async () => {},
    vi.fn(),
    "test",
  );
  if (!socket) throw new Error("Browser stream missing");
  for (const [seq, width, height] of [
    [1, 1008, 625],
    [2, 1262, 568],
  ]) {
    command.mockResolvedValueOnce({ result: [width, height] });
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "frame",
          seq,
          data: "jpeg",
          metadata: { deviceWidth: 1280, deviceHeight: 720, timestamp: seq },
        }),
      }),
    );
    expect(await view.next(new AbortController().signal)).toMatchObject({
      seq,
      width,
      height,
    });
  }
  await view.close();
});
