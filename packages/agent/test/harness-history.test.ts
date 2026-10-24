import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import {
  nativeCheckpoint,
  nativeHistory,
} from "../src/harness/native-history.mjs";

test("Pi checkpoints and recovers a large transcript without transporting old images", async () => {
  const home = await mkdtemp(join(tmpdir(), "domos-history-"));
  onTestFinished(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, "pi", "sessions"), { recursive: true });
  const sessionId = join(home, "pi", "sessions", "session.jsonl");
  const old = JSON.stringify({
    type: "message",
    id: "old",
    parentId: null,
    message: {
      role: "user",
      content: [{ type: "image", data: "A".repeat(1024 * 1024) }],
    },
  });
  const entries = [
    ...Array.from({ length: 20 }, () => old),
    JSON.stringify({
      type: "message",
      id: "request",
      parentId: "old",
      message: { role: "user", content: "Work" },
    }),
    JSON.stringify({
      type: "message",
      id: "answer",
      parentId: "request",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [
          { type: "text", text: "Saved" },
          { type: "image", data: "A".repeat(1024 * 1024) },
        ],
      },
    }),
  ];
  await writeFile(sessionId, `${entries.join("\n")}\n`);
  expect(await nativeCheckpoint({ provider: "pi", sessionId }, home)).toBe(
    "answer",
  );
  const history = await nativeHistory(
    { provider: "pi", sessionId, since: "old" },
    home,
  );
  expect(history.map((entry) => entry.id)).toEqual(["request", "answer"]);
  expect(JSON.stringify(history).length).toBeLessThan(1000);
  await expect(
    nativeHistory({ provider: "pi", sessionId, since: "missing" }, home),
  ).rejects.toThrow();
  await expect(
    nativeCheckpoint(
      { provider: "pi", sessionId: join(home, "private.jsonl") },
      home,
    ),
  ).rejects.toThrow();
});
