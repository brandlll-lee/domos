import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import {
  BACKGROUND_CONTEXT as context,
  withAbortSignal,
} from "@earendil-works/chord/context";
import type { EngineConfig } from "../harness/types.ts";
import { openChat } from "../open-chat.ts";
import { parseConfig } from "../runtime/config.ts";
import { readMemoryTrace } from "./memory-trace.ts";
import { validateEvalConfig } from "./task-config.ts";

export type NativeEvalInput = {
  directory: string;
  config: EngineConfig;
  seconds: number;
  prompt?: string;
};
export type NativeEvalResult = {
  failure: string | null;
  version: string | null;
  text: string;
  tokens: number | null;
  cost: number | null;
  knownCost: number;
  catalog?: unknown;
};

process.once("message", async (input: NativeEvalInput) => {
  const result: NativeEvalResult = {
    failure: null,
    version: null,
    text: "",
    tokens: null,
    cost: null,
    knownCost: 0,
  };
  const cancellation = new AbortController();
  const bounded = withAbortSignal(cancellation.signal, context);
  const timer = setTimeout(() => cancellation.abort(), input.seconds * 1000);
  let runtime: Awaited<ReturnType<typeof openChat>> | undefined;
  let observing = true;
  let responder: Promise<void> | undefined;
  try {
    runtime = await openChat(
      context,
      parseConfig(
        { dataDir: input.directory, computer: { kind: "process" } },
        join(input.directory, "config.json"),
      ),
    );
    const engines = runtime.engines;
    if (!engines) throw new Error("Native runtime required");
    const botId = runtime.conversation.id;
    await runtime.computer.authorize("process", true, bounded);
    const catalog = await engines.connections.inspect(
      botId,
      input.config,
      bounded,
    );
    result.version = catalog.version ?? null;
    if (!input.prompt) {
      result.catalog = {
        ready: catalog.ready,
        authenticated: catalog.authenticated,
        version: catalog.version,
        models: catalog.models,
        controls: "controls" in catalog ? catalog.controls : undefined,
      };
    } else {
      validateEvalConfig(input.config, catalog);
      await engines.configure(
        botId,
        {
          config: input.config,
          revision: (await engines.profile(botId, bounded)).revision,
          requestId: randomUUID(),
        },
        bounded,
      );
      await runtime.work.memory.setReviewEnabled(botId, false, bounded);
      responder = (async () => {
        while (observing && !cancellation.signal.aborted) {
          for (const row of (await engines.view(botId, bounded)).messages)
            if (row.approval?.state === "pending") {
              result.failure = "Judge requested an interaction";
              await engines.stop(botId, context);
              cancellation.abort();
            }
          await pause(150, undefined, { signal: cancellation.signal });
        }
      })().catch((error) => {
        if (!cancellation.signal.aborted) {
          result.failure = String(error);
          cancellation.abort();
        }
      });
      const receipt = await engines.submit(
        botId,
        { text: input.prompt, requestId: "eval:judge:0" },
        bounded,
      );
      const outcome = await receipt.wait(bounded);
      if (outcome.status !== "done")
        throw new Error(`Judge task ended: ${outcome.status}`);
    }
  } catch (error) {
    result.failure ??= String(error);
  } finally {
    clearTimeout(timer);
    observing = false;
    await responder;
    if (runtime?.engines && input.prompt) {
      try {
        const botId = runtime.conversation.id;
        await runtime.engines.stop(botId, context);
        const trace = await readMemoryTrace(
          runtime.conversation,
          "judge",
          context,
        );
        result.text = trace.answers
          .flatMap((a) => a.messages.map((m) => m.text))
          .join("\n");
        if (trace.calls.length) result.failure = "Judge used tools";
        const usage = (
          await runtime.engines.usageSummary(
            [botId],
            {},
            "model",
            "tokens",
            20,
            context,
          )
        ).totals;
        result.tokens = usage.tokens;
        result.cost = usage.unpriced || !usage.records ? null : usage.cost;
        result.knownCost = usage.cost ?? 0;
        await writeFile(
          join(input.directory, "native.json"),
          JSON.stringify({ input, result, trace, usage }, null, 2),
        );
      } catch (error) {
        result.failure = `Judge evidence failed: ${error}`;
      }
    }
    try {
      await runtime?.close();
    } catch (error) {
      result.failure = `Judge cleanup failed: ${error}`;
    }
    process.send?.(result);
    process.disconnect?.();
  }
});
