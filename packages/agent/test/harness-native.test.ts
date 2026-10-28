import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished, test } from "vitest";
import { WorkProcess } from "../src/harness/process.ts";
import { engineProvider } from "../src/harness/providers/index.ts";
import type { EngineSession } from "../src/harness/types.ts";

test
  .skipIf(process.env.DOMOS_NATIVE_SMOKE !== "1")
  .each(["pi", "codex", "claude", "opencode"])(
  "%s completes a native text turn on this work computer",
  async (id) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-native-smoke-"));
    const worker = new WorkProcess(
      [
        process.execPath,
        fileURLToPath(new URL("../src/harness/worker.mjs", import.meta.url)),
      ],
      { cwd: directory, home: directory },
      [],
      async () => {
        throw new Error("Smoke test tools are disabled");
      },
    );
    onTestFinished(async () => {
      await worker.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 10 });
    });
    const replies: string[] = [];
    let session: EngineSession | undefined;
    session = await engineProvider(id).open({
      process: worker,
      config: {
        provider: id,
        model: process.env[`DOMOS_NATIVE_${id.toUpperCase()}_MODEL`] ?? null,
      },
      sessionId: null,
      instructions:
        "Reply to the text request. Do not call any tools or change any files.",
      approve: async () => ({ allow: false }),
      emit: async (event) => {
        if (event.type === "message") replies.push(event.text);
        if (event.type === "approval")
          await session?.answer(event.approval.id, { allow: false });
      },
    });
    await session.prompt(
      "Reply with exactly DOMOS_HARNESS_OK. Do not use tools.",
    );
    expect(replies.join("\n")).toContain("DOMOS_HARNESS_OK");
  },
  90_000,
);
