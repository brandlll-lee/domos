import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  BACKGROUND_CONTEXT as context,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { ComputerRequests } from "../computer/runtime.ts";
import { conversationFiles } from "../files.ts";
import { EngineDoc, EngineMessage } from "../harness/state.ts";
import type { EngineConfig } from "../harness/types.ts";
import type { openChat } from "../open-chat.ts";
import { parseConfig } from "../runtime/config.ts";
import { memoryCases } from "./memory-cases.ts";
import { readMemoryTrace } from "./memory-trace.ts";
import { monitoringInstructions, taskCase, taskFiles } from "./task-cases.ts";
import { validateEvalConfig } from "./task-config.ts";
import { taskFixture } from "./task-fixture.ts";
import { taskEvidence } from "./task-score.ts";

export type TaskWorkerInput = {
  id: string;
  directory: string;
  codeRoot: string;
  config: EngineConfig;
  seconds: number;
  maxTokens: number;
};

process.once("message", async (input: TaskWorkerInput) => {
  const startedAt = Date.now();
  const cancellation = new AbortController();
  const bounded = withAbortSignal(cancellation.signal, context);
  let runtime: Awaited<ReturnType<typeof openChat>> | undefined;
  let fixture: Awaited<ReturnType<typeof taskFixture>> | undefined;
  let version: string | null = null;
  let stage: "environment" | "execution" | "budget" | "evidence" =
    "environment";
  let failure: {
    kind: "environment" | "execution" | "budget" | "evidence";
    message: string;
  } | null = null;
  const executions: unknown[] = [];
  const timer = setTimeout(() => cancellation.abort(), input.seconds * 1000);
  let responder: Promise<void> | undefined;
  let responding = true;
  let responderError: unknown;
  try {
    const task = taskCase(input.id);
    const target = (await import(
      pathToFileURL(join(input.codeRoot, "packages/agent/src/open-chat.ts"))
        .href
    )) as { openChat: typeof openChat };
    runtime = await target.openChat(
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
    version = catalog.version ?? null;
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
    if (input.id.startsWith("B")) {
      const services = await runtime.computer.tools.configure(
        botId,
        "browser",
        true,
        bounded,
      );
      if (!services.browser.available)
        throw new Error(services.browser.error ?? "Browser unavailable");
      if (services.browser.mode !== "headless")
        await runtime.computer.tools.browserMode(botId, "headless", bounded);
      const tools = await runtime.computer.tools.catalog(botId, bounded);
      if (!tools.some((tool) => tool.name.includes("agent_browser")))
        throw new Error("Browser product tools unavailable");
    }
    const workspace = await runtime.computer.workspace(botId, bounded);
    for (const [name, text] of Object.entries(taskFiles))
      await writeFile(join(workspace.cwd, name), text);
    if (task.memory) {
      const seed = memoryCases.find((item) => item.id === task.memory);
      if (!seed) throw new Error("Memory fixture missing");
      if ("seed" in seed)
        await runtime.harness.commit(
          (tx) =>
            tx.appendEntry(botId, {
              kind: EngineMessage,
              data: {
                id: "source",
                role: "user",
                content: [{ type: "text", text: seed.seed }],
              },
            }),
          bounded,
        );
      await runtime.work.memory.save(
        botId,
        {
          id: "seed",
          text: seed.memory,
          category: seed.category,
          shared: false,
          revision: 0,
          requestId: "seed",
        },
        bounded,
      );
      if (task.memory === "deletion")
        await runtime.work.memory.delete(botId, "seed", 1, bounded);
      if (task.memory === "isolation") {
        const other = await runtime.bots.create(
          { name: "隔离对象", requestId: "other" },
          bounded,
        );
        await runtime.work.memory.save(
          other.id,
          {
            id: "private",
            text: "机密代号-海盐松鼠-7392",
            shared: false,
            revision: 0,
            requestId: "private",
          },
          bounded,
        );
      }
    }
    fixture = await taskFixture();
    const answered = new Set<string>();
    responder = (async () => {
      while (responding && !cancellation.signal.aborted) {
        const view = await engines.view(botId, bounded);
        for (const message of view.messages) {
          const approval = message.approval;
          if (
            approval?.state !== "pending" ||
            answered.has(approval.request.id) ||
            !approval.request.id.startsWith("routine:") ||
            !["R1", "R2"].includes(input.id)
          )
            continue;
          answered.add(approval.request.id);
          await engines.answer(
            botId,
            approval.request.id,
            { allow: input.id === "R1" },
            bounded,
          );
        }
        await pause(150, undefined, { signal: cancellation.signal });
      }
    })().catch((error) => {
      if (!cancellation.signal.aborted) {
        responderError = error;
        cancellation.abort();
      }
    });
    const checkBudget = async () => {
      const totals = (
        await engines.usageSummary([botId], {}, "model", "tokens", 20, bounded)
      ).totals;
      if ((totals.tokens ?? 0) > input.maxTokens) {
        stage = "budget";
        throw new Error(`Reported token budget exceeded: ${totals.tokens}`);
      }
    };
    stage = "execution";
    const at = new Date(Date.now() + 90_000).toISOString();
    for (const [index, prompt] of task.prompts.entries()) {
      process.send?.({ phase: `request:${index + 1}` });
      const receipt = await engines.submit(
        botId,
        {
          text: prompt
            .replaceAll("{{url}}", fixture.url)
            .replaceAll("{{at}}", at),
          requestId: `eval:${input.id}:${index}`,
        },
        bounded,
      );
      const outcome = await receipt.wait(bounded);
      executions.push(
        await runtime.harness.snapshot(EngineDoc, botId, bounded),
      );
      if (outcome.status !== "done")
        throw new Error(`Native task ended: ${outcome.status}`);
      await checkBudget();
    }
    if (input.id === "R1") {
      while (true) {
        cancellation.signal.throwIfAborted();
        const runs = (await runtime.work.routines.list(botId, bounded)).runs;
        if (
          runs.some((run) => ["done", "failed", "stopped"].includes(run.status))
        )
          break;
        await pause(200, undefined, { signal: cancellation.signal });
      }
      await checkBudget();
      executions.push(
        await runtime.harness.snapshot(EngineDoc, botId, bounded),
      );
    }
    if (input.id === "R3" || input.id === "R4") {
      const routine = await runtime.work.routines.save(
        botId,
        {
          id: "monitor",
          revision: 0,
          requestId: "fixture",
          title: "Version monitor",
          instructions: monitoringInstructions,
          schedule: { type: "cron", expression: "0 0 1 1 *", timeZone: "UTC" },
          skillIds: [],
          delivery: "conditional",
          condition: "仅在版本相对上次基线发生变化时通知。",
        },
        bounded,
      );
      for (let index = 0; index < (input.id === "R3" ? 2 : 3); index++) {
        await writeFile(
          join(workspace.cwd, "version.txt"),
          input.id === "R4" && index > 0 ? "v2" : "v1",
        );
        const taskId = await runtime.work.routines.test(
          botId,
          routine.id,
          `eval:${input.id}:${index}`,
          bounded,
        );
        await runtime.harness.waitForTask(taskId, bounded);
        executions.push(
          await runtime.harness.snapshot(EngineDoc, botId, bounded),
        );
        await checkBudget();
      }
    }
    if (responderError) throw responderError;
  } catch (error) {
    failure = {
      kind: cancellation.signal.aborted ? "budget" : stage,
      message: String(responderError ?? error),
    };
  } finally {
    clearTimeout(timer);
    responding = false;
    await responder;
    if (runtime?.engines) {
      const botId = runtime.conversation.id;
      try {
        for (const item of (await runtime.work.routines.list(botId, context))
          .items)
          if (item.enabled)
            await runtime.work.routines.enable(
              botId,
              item.id,
              false,
              item.revision,
              randomUUID(),
              context,
            );
        await runtime.engines.stop(botId, context);
        const trace = await readMemoryTrace(
          runtime.conversation,
          input.id,
          context,
        );
        const view = await runtime.engines.view(botId, context);
        for (const row of trace.messages) {
          const projected = view.messages.find(
            (message) => message.id === row.message.id,
          );
          if (projected?.approval) row.message.approval = projected.approval;
        }
        const files = [];
        let offset = 0;
        do {
          const page = await conversationFiles(
            runtime.conversation,
            "",
            offset,
            100,
            context,
          );
          for (const item of page.items)
            files.push({
              id: item.file.id,
              name: item.file.name,
              content: await (
                await runtime.files.download(botId, item.file.id)
              ).text(),
              messageId: item.messageId,
            });
          if (page.next === null) break;
          offset = page.next;
        } while (offset > 0);
        const usageReport = await runtime.engines.usageSummary(
          [botId],
          {},
          "model",
          "tokens",
          20,
          context,
        );
        const usage = usageReport.totals;
        const workspace = await runtime.computer.workspace(botId, context);
        const result = taskEvidence.parse({
          workspace: Object.fromEntries(
            await Promise.all(
              [taskCase(input.id).artifact, "declined.txt"]
                .filter((name): name is string => Boolean(name))
                .map(async (name) => [
                  name,
                  await readFile(join(workspace.cwd, name), "utf8").catch(
                    (error: NodeJS.ErrnoException) => {
                      if (error.code === "ENOENT") return null;
                      throw error;
                    },
                  ),
                ]),
            ),
          ),
          context: {
            instructions:
              (await runtime.harness.snapshot(EngineDoc, botId, context))
                ?.prompt?.text ?? null,
            tools:
              (await runtime.harness.snapshot(ComputerRequests, botId, context))
                ?.tools ?? [],
          },
          id: input.id,
          botId,
          version,
          model: input.config.model,
          actualModels: usageReport.options,
          startedAt,
          endedAt: Date.now(),
          failure,
          trace,
          files,
          memories: await runtime.work.memory.list(botId, context),
          fixture: fixture?.state ?? {
            selections: [],
            submissions: [],
            downloads: 0,
            forbidden: 0,
            requests: [],
          },
          routines: await runtime.work.routines.list(botId, context),
          executions,
          usage: {
            tokens: usage.tokens,
            cost: usage.unpriced || !usage.records ? null : usage.cost,
            native: usage,
          },
        });
        await writeFile(
          join(input.directory, "evidence.json"),
          `${JSON.stringify(result, null, 2)}\n`,
        );
      } catch (error) {
        failure = { kind: "evidence", message: String(error) };
      }
    }
    try {
      await fixture?.close();
      await runtime?.close();
    } catch (error) {
      failure = { kind: "evidence", message: `Cleanup failed: ${error}` };
    }
    process.send?.({ failure });
    process.disconnect?.();
  }
});
