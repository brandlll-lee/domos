import { expect, test, vi } from "vitest";
import {
  viewerQueue,
  viewportPoint,
} from "../src/features/computer/viewer-input.ts";

test("browser coordinates match the depicted page and exclude letterboxing", () => {
  const image = { naturalWidth: 1262, naturalHeight: 568 };
  const frame = { width: 1280, height: 720 };
  const rect = { left: 20, top: 30, width: 631, height: 284 };
  expect(viewportPoint(image, rect, frame, 335.5, 172, true)).toEqual({
    x: 640,
    y: 288,
  });
  expect(viewportPoint(image, rect, frame, 335.5, 172, false)).toEqual({
    x: 640,
    y: 360,
  });
  expect(
    viewportPoint(image, { ...rect, height: 500 }, frame, 30, 35, true),
  ).toBeUndefined();
  expect(viewportPoint(image, rect, frame, 9999, 9999, true, true)).toEqual({
    x: 1279,
    y: 575,
  });
  expect(
    viewportPoint(image, { ...rect, width: 0 }, frame, 20, 30, true),
  ).toBeUndefined();
});

test("an uncertain input stops queued typing and still permits hand-back", async () => {
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const dispatch = vi.fn(async () => {
    started.resolve();
    await gate.promise;
  });
  const failed = vi.fn();
  const send = viewerQueue(dispatch, failed);
  const first = send({ type: "text", text: "first" });
  await started.promise;
  const second = send({ type: "text", text: "second" });
  gate.reject(new Error("unknown"));
  expect(await first).toBe(false);
  expect(await second).toBe(false);
  expect(dispatch).toHaveBeenCalledTimes(1);
  dispatch.mockResolvedValue();
  expect(await send({ type: "back" })).toBe(true);
  expect(await send({ type: "text", text: "third" })).toBe(false);
  expect(failed).toHaveBeenCalledTimes(1);
});

test("pointer moves coalesce and a slow connection cannot grow the queue", async () => {
  const gate = Promise.withResolvers<void>();
  const dispatch = vi.fn(async () => {
    await gate.promise;
  });
  const failed = vi.fn();
  const send = viewerQueue(dispatch, failed);
  const first = send({ type: "take" });
  const move = (x: number) =>
    send({
      type: "pointer",
      event: "move",
      x,
      y: 1,
      button: "left",
      deltaX: 0,
      deltaY: 0,
    });
  const older = move(1);
  const newer = move(2);
  expect(await older).toBe(false);
  gate.resolve();
  expect(await first).toBe(true);
  expect(await newer).toBe(true);
  expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ x: 2 }));
  const hold = Promise.withResolvers<void>();
  dispatch.mockImplementation(async () => {
    await hold.promise;
  });
  const entries = Array.from({ length: 34 }, () =>
    send({ type: "text", text: "x" }),
  );
  hold.resolve();
  await Promise.all(entries);
  expect(failed).toHaveBeenCalledTimes(1);
  expect(await send({ type: "take" })).toBe(false);
});
