import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  window: vi.fn(),
  hover: vi.fn(),
  human: vi.fn(),
}));
vi.mock("@trycua/cua-driver", () => ({
  CuaDriver: {
    create: () => ({
      callTool: mocks.call,
      shutdown: async () => {},
      uniffiDestroy() {},
    }),
  },
}));
vi.mock("../src/harness/browser-service.mjs", () => ({
  openBrowserService: async () => ({
    window: mocks.window,
    hover: mocks.hover,
    human: mocks.human,
    close: async () => {},
  }),
}));
vi.mock("../src/harness/desktop-activity.mjs", () => ({
  openDesktopActivity: () => ({
    capture: (execute: () => unknown) => execute(),
    close: async () => {},
  }),
}));
const entry = "../src/harness/computer-service.mjs";
const { openComputerService } = await import(entry);
afterEach(() => vi.resetAllMocks());

test.each([false, true])(
  "native browser input retries only an explicit delivery refusal (%s)",
  async (nested) => {
    mocks.window.mockResolvedValue(12);
    mocks.human.mockImplementation((execute: () => unknown) => execute());
    mocks.call.mockImplementation(async (name: string, args: string) => {
      const input = JSON.parse(args);
      if (name === "list_windows")
        return {
          structuredJson: JSON.stringify({
            windows: [
              { pid: 12, window_id: 34, bounds: { width: 1000, height: 800 } },
            ],
          }),
        };
      if (name === "get_window_state")
        return {
          images: [{ dataBase64: "png", mimeType: "image/png" }],
          structuredJson: JSON.stringify({
            screenshot_width: 1000,
            screenshot_height: 800,
          }),
        };
      expect(input.target).toEqual({ kind: "window", pid: 12, window_id: 34 });
      if (!input.delivery_mode)
        return {
          isError: true,
          structuredJson: JSON.stringify(
            nested
              ? { refusal: { code: "background_unavailable" } }
              : { code: "background_unavailable" },
          ),
        };
      return { isError: false };
    });
    const service = openComputerService("work", "home");
    const signal = AbortSignal.timeout(1000);
    const view = { service: "browser", operation: "view", id: "viewer" };
    try {
      await service.request({ ...view, action: "open" }, signal);
      await service.request({ ...view, action: "next" }, signal);
      await service.request(
        {
          ...view,
          action: "send",
          message: { type: "key", key: "Tab", modifiers: 0 },
        },
        signal,
      );
      expect(
        mocks.call.mock.calls.filter(([name]) => name === "press_key"),
      ).toHaveLength(2);
      mocks.call.mockClear();
      mocks.call.mockResolvedValue({
        isError: true,
        structuredJson: JSON.stringify({ code: "outcome_unknown" }),
        text: "Unknown",
      });
      await expect(
        service.request(
          {
            ...view,
            action: "send",
            message: { type: "key", key: "Enter", modifiers: 0 },
          },
          signal,
        ),
      ).rejects.toThrow("Unknown");
      expect(mocks.call).toHaveBeenCalledTimes(1);
    } finally {
      await service.close();
    }
  },
);

test("two visible windows cannot bind the browser viewer", async () => {
  mocks.window.mockResolvedValue(12);
  mocks.call.mockResolvedValue({
    structuredJson: JSON.stringify({
      windows: [34, 56].map((window_id) => ({
        pid: 12,
        window_id,
        bounds: { width: 1000, height: 800 },
      })),
    }),
  });
  const service = openComputerService("work", "home");
  try {
    await expect(
      service.request(
        { service: "browser", operation: "view", id: "viewer", action: "open" },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("一个可见");
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.human).not.toHaveBeenCalled();
  } finally {
    await service.close();
  }
});
