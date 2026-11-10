import { describe, expect, it, vi } from "vitest";
import { createReadState } from "../src/features/read-state.ts";

describe("shared reads", () => {
  it("shares an unfinished read and retains its result after readers leave", async () => {
    const result = Promise.withResolvers<string[]>();
    const read = vi.fn(() => result.promise);
    const store = createReadState(read);
    const unsubscribe = store.subscribe(() => {});
    const first = store.load();
    unsubscribe();
    expect(store.load()).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
    result.resolve(["Docs"]);
    await first;
    expect(await store.load()).toEqual(["Docs"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retains content on refresh failure and retries only on request", async () => {
    const read = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["Docs"])
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(["Search"]);
    const store = createReadState(read);
    await store.load();
    const refreshing = store.load(true);
    expect(store.snapshot()).toMatchObject({ data: ["Docs"], loading: true });
    await expect(refreshing).rejects.toThrow("Offline");
    expect(store.snapshot()).toMatchObject({ data: ["Docs"], loading: false });
    await expect(store.load()).rejects.toThrow("Offline");
    expect(read).toHaveBeenCalledTimes(2);
    expect(await store.load(true)).toEqual(["Search"]);
  });

  it("rejects stale responses after a context change", async () => {
    const old = Promise.withResolvers<string>();
    const read = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValueOnce("Current computer");
    const store = createReadState(read);
    const pending = store.load();
    store.clear();
    expect(read.mock.calls[0]?.[0].aborted).toBe(true);
    expect(store.snapshot().data).toBeUndefined();
    await store.load();
    old.resolve("Old computer");
    await pending;
    expect(store.snapshot().data).toBe("Current computer");
  });

  it("keeps a live update when an earlier read finishes later", async () => {
    const result = Promise.withResolvers<string>();
    const store = createReadState(() => result.promise);
    const pending = store.load();
    store.receive("Saved configuration");
    result.resolve("Previous configuration");
    await pending;
    expect(store.snapshot().data).toBe("Saved configuration");
  });
});
