import { randomUUID } from "node:crypto";
import {
  BACKGROUND_CONTEXT as context,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { EngineDoc, EngineMessage } from "../harness/state.ts";
import type { EngineConfig } from "../harness/types.ts";
import { openChat } from "../open-chat.ts";
import { parseConfig } from "../runtime/config.ts";
import { type MemoryCase, memoryCases } from "./memory-cases.ts";
import { readMemoryTrace } from "./memory-trace.ts";

export type MemoryWorkerInput = {
  id: MemoryCase["id"];
  directory: string;
  config: EngineConfig;
  seconds: number;
  maxTokens: number;
  catalog?: boolean;
  resume?: boolean;
};

process.once("message", async (input: MemoryWorkerInput) => {
  const startedAt = Date.now();
  const config = parseConfig(
    { dataDir: input.directory, computer: { kind: "process" } },
    `${input.directory}/config.json`,
  );
  let runtime: Awaited<ReturnType<typeof openChat>> | undefined;
  let stage = "environment";
  let aborted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancellation = new AbortController();
  const bounded = withAbortSignal(cancellation.signal, context);
  const privateMarker = "机密代号-海盐松鼠-7392";
  let version: string | null | undefined;
  let failure: Record<string, unknown> | undefined;
  let result: Record<string, unknown> | undefined;
  try {
    process.send?.({ phase: "open" });
    runtime = await openChat(context, config);
    const engines = runtime.engines;
    if (!engines) throw new Error("Native runtime required");
    const botId = runtime.conversation.id;
    timer = setTimeout(() => {
      aborted = true;
      cancellation.abort();
      void engines
        .stop(botId, context)
        .catch((error) => console.error("Eval stop failed", error));
    }, input.seconds * 1000);
    await runtime.computer.authorize("process", true, bounded);
    const catalog = await engines.connections.inspect(
      botId,
      input.config,
      bounded,
    );
    version = catalog.version;
    if (input.catalog) {
      process.send?.({
        catalog: {
          ready: catalog.ready,
          authenticated: catalog.authenticated,
          version: catalog.version,
          models: catalog.models.map(({ id, name, effort }) => ({
            id,
            name,
            effort,
          })),
        },
      });
      return;
    }
    if (!catalog.ready || catalog.authenticated === false)
      throw new Error(catalog.message);
    if (!catalog.models.some((item) => item.id === input.config.model))
      throw new Error(
        `Model is not in the native catalog: ${input.config.model}`,
      );
    const selected = await engines.profile(botId, bounded);
    process.send?.({ phase: "configure" });
    await engines.configure(
      botId,
      {
        config: input.config,
        revision: selected.revision,
        requestId: randomUUID(),
      },
      bounded,
    );
    const task = memoryCases.find((item) => item.id === input.id);
    if (!task) throw new Error(`Unknown memory case: ${input.id}`);
    if (!input.resume) {
      if ("seed" in task)
        await runtime.harness.commit(async (tx) => {
          await tx.appendEntry(botId, {
            kind: EngineMessage,
            data: {
              id: "source",
              role: "user",
              content: [{ type: "text", text: task.seed }],
            },
          });
        }, bounded);
      await runtime.work.memory.save(
        botId,
        {
          id: "seed",
          text: task.memory,
          category: task.category,
          shared: false,
          revision: 0,
          requestId: "seed",
        },
        bounded,
      );
      await runtime.work.memory.setReviewEnabled(botId, false, bounded);
      const other = await runtime.bots.create(
        { name: "隔离对象", requestId: "other" },
        bounded,
      );
      await runtime.work.memory.save(
        other.id,
        {
          id: "private",
          text: privateMarker,
          shared: false,
          revision: 0,
          requestId: "private",
        },
        bounded,
      );
      if (input.id === "deletion")
        await runtime.work.memory.delete(botId, "seed", 1, bounded);
      if (input.id === "restart") {
        process.send?.({ checkpoint: true });
        await new Promise(() => {});
      }
    }
    stage = "execution";
    for (const [index, text] of task.prompts.entries()) {
      process.send?.({ phase: `request:${index + 1}` });
      const submission = await engines.submit(
        botId,
        { text, requestId: `eval:${input.id}:${index}` },
        bounded,
      );
      const outcome = await submission.wait(bounded);
      if (outcome.status !== "done")
        throw new Error(`Native task ended with ${outcome.status}`);
      const totals = (
        await engines.usageSummary([botId], {}, "model", "tokens", 20, bounded)
      ).totals;
      if ((totals.tokens ?? 0) > input.maxTokens) {
        stage = "budget";
        throw new Error(`Reported token budget exceeded: ${totals.tokens}`);
      }
    }
  } catch (error) {
    const state = runtime
      ? await runtime.harness.snapshot(
          EngineDoc,
          runtime.conversation.id,
          context,
        )
      : undefined;
    failure = {
      kind: aborted ? "budget" : stage,
      message: error instanceof Error ? error.message : String(error),
      startedAt,
      endedAt: Date.now(),
      database: `${input.directory}/agent.sqlite`,
      execution: state?.run ?? null,
      nativeError: state?.error ?? null,
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (runtime?.engines && !input.catalog) {
      const botId = runtime.conversation.id;
      const engines = runtime.engines;
      try {
        const trace = await readMemoryTrace(
          runtime.conversation,
          input.id,
          context,
        );
        const evidence = await runtime.harness.snapshot(
          EngineDoc,
          botId,
          context,
        );
        const usage = await engines.usageSummary(
          [botId],
          {},
          "model",
          "tokens",
          20,
          context,
        );
        result = {
          id: input.id,
          ...trace,
          memories: await runtime.work.memory.list(botId, context),
          privateMarker,
          startedAt,
          endedAt: Date.now(),
          version,
          usage: usage.totals,
          evidence: evidence?.run?.evidence ?? null,
          database: `${input.directory}/agent.sqlite`,
        };
      } catch (error) {
        failure = {
          ...failure,
          kind: failure?.kind ?? "evidence",
          evidenceError: String(error),
        };
      }
      process.send?.({
        ...(result ? { result } : {}),
        ...(failure ? { failure } : {}),
      });
    } else if (failure) process.send?.({ failure });
    await runtime?.close();
    process.disconnect?.();
  }
});
