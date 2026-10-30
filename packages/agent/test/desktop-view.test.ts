import { expect, test, vi } from "vitest";

const entry = "../src/harness/desktop-view.mjs";
const { openDesktopView } = await import(entry);

test("a cancelled desktop gesture cannot become a late click", async () => {
  const callTool = vi.fn(async () => ({ isError: false }));
  const view = openDesktopView({ callTool }, "test");
  const signal = AbortSignal.timeout(1000);
  const pointer = {
    type: "pointer",
    x: 10,
    y: 10,
    button: "left",
    deltaX: 0,
    deltaY: 0,
  };
  await view.send({ ...pointer, event: "down" }, signal);
  await view.send({ ...pointer, event: "cancel" }, signal);
  await view.send({ ...pointer, event: "up" }, signal);
  expect(callTool).not.toHaveBeenCalled();
  await view.send({ ...pointer, event: "down" }, signal);
  await view.send({ type: "back" }, signal);
  await view.send({ ...pointer, event: "up" }, signal);
  expect(callTool).not.toHaveBeenCalled();
  await view.send({ ...pointer, event: "down" }, signal);
  await view.send({ ...pointer, event: "up" }, signal);
  expect(callTool).toHaveBeenCalledWith("click", expect.any(String), {
    signal,
  });
  view.close();
});
