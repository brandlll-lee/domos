import { createServer } from "node:http";
import { expect, onTestFinished, test } from "vitest";

const entry = "../src/harness/browser-command.mjs";
const { browserCommand } = await import(entry);

test("the pinned native relay checks replies, origin, size and cancellation", async () => {
  const requests: { origin?: string; body: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ origin: request.headers.origin, body });
    const command = JSON.parse(body);
    response.setHeader("Content-Type", "application/json");
    if (command.action === "large") response.end("x".repeat(65537));
    else if (command.action === "fail")
      response.end(JSON.stringify({ success: false }));
    else
      response.end(JSON.stringify({ success: true, data: { text: "中文" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Address required");
  const signal = () => AbortSignal.timeout(3000);
  expect(
    await browserCommand(address.port, { action: "session_info" }, signal()),
  ).toEqual({ text: "中文" });
  expect(requests[0]).toEqual({
    origin: `http://127.0.0.1:${address.port}`,
    body: '{"action":"session_info"}',
  });
  await expect(
    browserCommand(address.port, { action: "fail" }, signal()),
  ).rejects.toThrow("未确认");
  await expect(
    browserCommand(address.port, { action: "large" }, signal()),
  ).rejects.toThrow("过大");
  await expect(
    browserCommand(address.port, {}, AbortSignal.abort()),
  ).rejects.toThrow();
});
