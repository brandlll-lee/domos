import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAgent } from "@domos/agent";
import type { Computers } from "@domos/agent/computer/catalog";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, onTestFinished, test } from "vitest";
import { ProtocolProcess } from "../../../packages/agent/test/fixtures/engine-process.ts";
import { createApp } from "../src/app.ts";
import type { AppRouter } from "../src/router.ts";

test("Claude questions return distinct answers and use the Bot skill and memory authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-interaction-"));
  const models = createModels();
  models.setProvider(fauxProvider().provider);
  const skillId = crypto.randomUUID();
  let updatedInput: unknown;
  const computers = {
    initialize: async () => {},
    preflight: async () => {},
    computerId: async () => "local",
    tools: { catalog: async () => [], finish: () => {} },
    process: async (...args: Parameters<Computers["process"]>) => {
      const process = new ProtocolProcess();
      const launch = process.launch.bind(process);
      process.launch = async (spec) => {
        if (spec.args.includes("--version")) {
          process.output.write("fixture-cli 1.0.0\n");
          process.ended.resolve({ code: 0 });
        } else await launch(spec);
      };
      process.request = async <T>(path: string) =>
        (path === "/provider" ? { all: [], connected: [] } : {}) as T;
      process.receive = async (request) => {
        if (request.type !== "user") return;
        const memory = await args[2](
          "memory",
          "memory_list",
          {},
          new AbortController().signal,
        );
        const skill = await args[2](
          "skill",
          "skill_read",
          { id: skillId },
          new AbortController().signal,
        );
        const result = await args[2](
          "ask",
          "approve",
          {
            tool_name: "AskUserQuestion",
            input: {
              questions: [
                {
                  question: "Target?",
                  options: [{ label: "Preview", description: "Test release" }],
                  multiSelect: false,
                },
                {
                  question: "Regions?",
                  options: [{ label: "EU" }, { label: "US" }],
                  multiSelect: true,
                },
              ],
            },
          },
          new AbortController().signal,
        );
        updatedInput = JSON.parse((result.content[0] as { text: string }).text);
        process.frame({
          type: "assistant",
          message: {
            id: "answer",
            content: [
              {
                type: "text",
                text: JSON.stringify({ memory, skill, updatedInput }),
              },
            ],
          },
        });
        process.frame({ type: "result" });
      };
      return process;
    },
  } as unknown as Computers;
  const runtime = await openAgent(
    join(directory, "agent.sqlite"),
    { registry: createRegistry(), models, computers },
    {},
    context,
  );
  onTestFinished(async () => {
    await runtime.harness.close(context);
    await rm(directory, { recursive: true, force: true });
  });
  const app = createApp(
    runtime.bots,
    models,
    runtime.files,
    runtime.work,
    undefined,
    undefined,
    runtime.engines,
  );
  const client: RouterClient<AppRouter> = createORPCClient(
    new RPCLink({
      url: "http://localhost/rpc",
      fetch: async (request, init) => app.fetch(new Request(request, init)),
    }),
  );
  const botId = runtime.conversation.id;
  await client.engines.configure({
    botId,
    config: { provider: "claude", model: null },
    revision: 0,
    requestId: crypto.randomUUID(),
  });
  await client.work.memory.save({
    botId,
    id: crypto.randomUUID(),
    text: "Use Chinese",
    shared: false,
    revision: 0,
    requestId: crypto.randomUUID(),
  });
  const skill = await client.work.skills.save({
    botId,
    id: skillId,
    content:
      "---\nname: release\ndescription: Release work\n---\nCheck the release.",
    revision: 0,
    requestId: crypto.randomUUID(),
  });
  await client.work.skills.enable({
    botId,
    id: skill.id,
    revision: skill.revision,
    enabled: true,
    requestId: crypto.randomUUID(),
  });
  const submission = await client.send({
    botId,
    text: "Work",
    requestId: crypto.randomUUID(),
  });
  await expect
    .poll(async () => (await client.get({ botId })).approvals?.[0]?.kind)
    .toBe("question");
  const approval = (await client.get({ botId })).approvals?.[0];
  if (!approval) throw new Error("Native question was not received");
  await expect(
    client.engines.accounts({ botId, provider: "opencode" }),
  ).resolves.toMatchObject({ providers: [] });
  await expect(
    client.engines.key({ botId, provider: "claude", key: "fixture-key" }),
  ).rejects.toThrow("请先停止此引擎的工作");
  expect((await client.engines.get({ botId })).config.provider).toBe("claude");
  expect(approval?.questions).toMatchObject([
    { id: "Target?", multiple: false },
    { id: "Regions?", multiple: true },
  ]);
  await client.engines.answer({
    botId,
    id: approval.id,
    allow: true,
    answers: { "Target?": ["Preview"], "Regions?": ["EU", "US"] },
  });
  await runtime.harness
    .submission(submission.id, context)
    .then((item) => item?.wait(context));
  expect(updatedInput).toMatchObject({
    behavior: "allow",
    updatedInput: { answers: { "Target?": "Preview", "Regions?": "EU, US" } },
  });
  expect(JSON.stringify((await client.get({ botId })).messages)).toContain(
    "Use Chinese",
  );
  expect(JSON.stringify((await client.get({ botId })).messages)).toContain(
    "Check the release.",
  );
});
