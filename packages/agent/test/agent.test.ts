import { fork } from "node:child_process";
import { once } from "node:events";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  type Submission,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, onTestFinished, test } from "vitest";
import { openAgent } from "../src/open-agent.ts";

const context = BACKGROUND_CONTEXT;
const agent = { model: { provider: "faux", modelId: "faux-1" } };

function model() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

async function database(cleanup: (fn: () => Promise<void>) => void) {
  const directory = await mkdtemp(join(tmpdir(), "domos-agent-"));
  cleanup(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "agent.sqlite");
}

test("adopts the existing root conversation with its history and configuration", async () => {
  const file = await database(onTestFinished);
  const { faux, models } = model();
  const options = { models, registry: createRegistry() };
  const harness = await Harness.open(
    await openNodeSqliteStorage(file),
    options,
    context,
  );
  const root = await harness.root(context, {
    agent: { ...agent, instructions: "Existing instructions" },
  });
  faux.setResponses([fauxAssistantMessage("Existing answer")]);
  try {
    const submission = await root.submit(
      { type: "input", content: "Existing question" },
      context,
    );
    await submission.wait(context);
  } finally {
    await harness.close(context);
  }
  const runtime = await openAgent(file, options, agent, context);
  try {
    expect(await runtime.bots.list(context)).toEqual([
      { id: root.id, name: "Domos" },
    ]);
    const conversation = await runtime.bots.conversation(root.id, context);
    expect(conversation?.id).toBe(root.id);
    expect(await conversation?.agent(context)).toMatchObject({
      ...agent,
      instructions: "Existing instructions",
    });
    expect(
      (await conversation?.context(context))?.messages.at(-1),
    ).toMatchObject({ content: [{ type: "text", text: "Existing answer" }] });
  } finally {
    await runtime.harness.close(context);
  }
});

test("retains the transcript and deduplicates a request after reopening", async () => {
  const file = await database(onTestFinished);
  const { faux, models } = model();
  const options = { models, registry: createRegistry() };
  faux.setResponses([fauxAssistantMessage("Saved answer")]);
  const first = await openAgent(file, options, agent, context);
  const input = {
    type: "input",
    content: "Remember this.",
    requestId: "input-1",
  } as const;
  let submissionId: Submission["id"];
  try {
    const submission = await first.conversation.submit(input, context);
    submissionId = submission.id;
    expect((await submission.wait(context)).status).toBe("done");
    expect((await first.conversation.submit(input, context)).id).toBe(
      submission.id,
    );
  } finally {
    await first.harness.close(context);
  }

  const second = await openAgent(file, options, agent, context);
  try {
    expect(second.conversation.id).toBe(first.conversation.id);
    const submission = await second.conversation.submit(input, context);
    expect(submission.id).toBe(submissionId);
    expect((await submission.wait(context)).status).toBe("done");
    const history = await second.conversation.context(context);
    expect(
      history.messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
    expect(history.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Saved answer" }],
    });
    expect(faux.state.callCount).toBe(1);
  } finally {
    await second.harness.close(context);
  }
});

test("detaching a viewer and cancelling a wait keep the task running", async () => {
  const file = await database(onTestFinished);
  const { faux, models } = model();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const registry = createRegistry();
  registry.install(
    defineExtension({
      name: "gate",
      tools: [
        defineTool({
          name: "gate",
          description: "Wait for the test to release the task.",
          parameters: Type.Object({}),
          execute: async () => {
            entered.resolve();
            await release.promise;
            return { output: [{ type: "text", text: "Released" }] };
          },
        }),
      ],
    }),
  );
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("gate", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("Finished"),
  ]);
  const { harness, conversation } = await openAgent(
    file,
    { models, registry },
    agent,
    context,
  );
  try {
    const submission = await conversation.submit(
      { type: "input", content: "Work." },
      context,
    );
    await entered.promise;
    const watch = await conversation.watch(context);
    watch.start(async () => {});
    await watch.stop();
    const cancellation = new AbortController();
    const waiting = submission.wait(
      withAbortSignal(cancellation.signal, context),
    );
    const rejected = expect(waiting).rejects.toBeDefined();
    cancellation.abort();
    await rejected;
    const duplicate = await conversation.submit(
      { type: "input", content: "Work.", requestId: "queued-input" },
      context,
    );
    expect(await duplicate.abort(context)).toBe("aborted");
    release.resolve();
    expect((await submission.wait(context)).status).toBe("done");
    const reattached = await conversation.watch(context);
    expect(
      reattached.value.entries.some((entry) => entry.kind === "pi.assistant"),
    ).toBe(true);
    await reattached.stop();
  } finally {
    release.resolve();
    await harness.close(context);
  }
});

test("an explicit stop ends active work and remains stopped after reopening", async () => {
  const file = await database(onTestFinished);
  const { faux, models } = model();
  const entered = Promise.withResolvers<void>();
  const registry = createRegistry();
  registry.install(
    defineExtension({
      name: "gate",
      tools: [
        defineTool({
          name: "gate",
          description: "Wait for cancellation.",
          parameters: Type.Object({}),
          execute: async (_args, _api, taskContext) => {
            entered.resolve();
            await once(taskContext.abortSignal as AbortSignal, "abort");
            return {};
          },
        }),
      ],
    }),
  );
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("gate", {}), { stopReason: "toolUse" }),
  ]);
  const options = { models, registry };
  const first = await openAgent(file, options, agent, context);
  let submissionId: Submission["id"];
  try {
    const submission = await first.conversation.submit(
      { type: "input", content: "Work." },
      context,
    );
    submissionId = submission.id;
    await entered.promise;
    await first.conversation.abort(context);
    expect(await submission.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
  } finally {
    await first.harness.close(context);
  }
  const second = await openAgent(file, options, agent, context);
  try {
    const submission = await second.harness.submission(submissionId, context);
    expect(await submission?.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "aborted",
    });
    expect(faux.state.callCount).toBe(1);
  } finally {
    await second.harness.close(context);
  }
});

test.each(["safe", "unsafe"] as const)(
  "a process crash follows the interrupted tool's replay=%s policy",
  async (replay) => {
    const file = await database(onTestFinished);
    const callsFile = join(file, "..", "calls.txt");
    const toolName = `probe_${crypto.randomUUID().replaceAll("-", "")}`;
    const requestId = crypto.randomUUID();
    await crashAt(file, callsFile, toolName, requestId, replay, "tool");
    const { faux, models } = model();
    faux.setResponses([fauxAssistantMessage("Recovered")]);
    const registry = probeRegistry(toolName, replay, callsFile);
    const { harness, conversation } = await openAgent(
      file,
      { models, registry },
      agent,
      context,
    );
    try {
      const submission = await conversation.submit(
        { type: "input", content: "Run the test operation.", requestId },
        context,
      );
      expect((await submission.wait(context)).status).toBe("done");
      const calls = (await readFile(callsFile, "utf8")).trim().split("\n");
      expect(calls).toHaveLength(replay === "safe" ? 2 : 1);
      const history = await conversation.context(context);
      const result = history.messages.find(
        (message) => message.role === "toolResult",
      );
      expect(result).toMatchObject({ isError: replay === "unsafe" });
    } finally {
      await harness.close(context);
    }
  },
);

test("a crash after a committed tool result preserves that result", async () => {
  const file = await database(onTestFinished);
  const callsFile = join(file, "..", "calls.txt");
  const toolName = `probe_${crypto.randomUUID().replaceAll("-", "")}`;
  const requestId = crypto.randomUUID();
  await crashAt(file, callsFile, toolName, requestId, "safe", "answer");
  const { faux, models } = model();
  faux.setResponses([fauxAssistantMessage("Recovered")]);
  const registry = probeRegistry(toolName, "safe", callsFile);
  const { harness, conversation } = await openAgent(
    file,
    { models, registry },
    agent,
    context,
  );
  try {
    const submission = await conversation.submit(
      { type: "input", content: "Run the test operation.", requestId },
      context,
    );
    expect((await submission.wait(context)).status).toBe("done");
    expect(await readFile(callsFile, "utf8")).toBe("called\n");
  } finally {
    await harness.close(context);
  }
});

function probeRegistry(
  toolName: string,
  replay: "safe" | "unsafe",
  callsFile: string,
) {
  const registry = createRegistry();
  registry.install(
    defineExtension({
      name: "probe",
      tools: [
        defineTool({
          name: toolName,
          description: "Record a test invocation.",
          parameters: Type.Object({}),
          replay,
          execute: async () => {
            await appendFile(callsFile, "called\n");
            return { output: [{ type: "text", text: "Recorded" }] };
          },
        }),
      ],
    }),
  );
  return registry;
}

async function crashAt(
  file: string,
  callsFile: string,
  toolName: string,
  requestId: string,
  replay: "safe" | "unsafe",
  checkpoint: "tool" | "answer",
) {
  const worker = fork(
    fileURLToPath(new URL("./fixtures/crash-worker.ts", import.meta.url)),
    [file, callsFile, toolName, requestId, replay, checkpoint],
    { execArgv: ["--experimental-strip-types"], silent: true },
  );
  let stderr = "";
  worker.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = once(worker, "exit");
  onTestFinished(async () => {
    worker.kill("SIGKILL");
    await exited;
  });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once("message", (message) => {
        expect(message).toEqual({ type: "ready" });
        resolve();
      });
      worker.once("error", reject);
      worker.once("exit", (code) =>
        reject(new Error(`Worker exited (${code}): ${stderr}`)),
      );
    });
  } finally {
    worker.kill("SIGKILL");
    await exited;
  }
}
