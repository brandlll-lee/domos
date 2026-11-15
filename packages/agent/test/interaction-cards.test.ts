import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAbortSignal } from "@earendil-works/chord/context";
import type { Credential } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, defineExtension } from "@earendil-works/pi-durable";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { expect, test, vi } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import {
  ComputerRequests,
  ComputerRuntime,
  QuestionDoc,
} from "../src/computer/runtime.ts";
import { EngineExecution } from "../src/harness/execution.ts";
import {
  completeCredentials,
  interactionExtension,
} from "../src/harness/interactions.ts";
import { mcpOperation } from "../src/harness/mcp-client.mjs";
import { engineProvider } from "../src/harness/providers/index.ts";
import { EngineDoc } from "../src/harness/state.ts";
import type { ProductResult } from "../src/harness/types.ts";
import { McpConnections } from "../src/mcp/connections.ts";
import { messageText } from "../src/messages.ts";
import { openAgent } from "../src/open-agent.ts";
import { engineTask, Runtime } from "../src/runtime/index.ts";
import { migrateRuntime } from "../src/runtime/migrate.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";
import { mcpFixture } from "./fixtures/mcp.mjs";
import { context, setup } from "./fixtures/work.ts";

test("media questions retain authorized file references and validate answers", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const execution = new EngineExecution({} as Computers, runtime.files);
  execution.computer = new ComputerRuntime(
    runtime.harness,
    createRegistry(),
    {} as Computers,
    runtime.files,
  );
  const tool = interactionExtension(execution).tools[2];
  const botId = runtime.conversation.id;
  const api = {
    conversationId: botId,
    taskId: 123,
    callId: "media",
    snapshot: runtime.harness.snapshot.bind(runtime.harness),
  } as Parameters<typeof tool.execute>[1];
  const file = await runtime.files.upload(
    botId,
    "report.md",
    Buffer.from("# Report"),
  );
  const input = {
    title: "选择方案",
    body: "请先查看材料",
    footer: "也可以自己填写",
    attachments: [file.id],
    questions: [
      {
        id: "plan",
        title: "选择方案",
        options: [
          {
            id: "plan-a",
            label: "方案 A",
            attachments: [file.id],
            actions: [
              { id: "learn-a", label: "了解更多" },
              { id: "choose-a", label: "选择此项" },
            ],
          },
        ],
      },
    ],
  };
  const state = () =>
    runtime.harness.snapshot(ComputerRequests, botId, context);
  try {
    const validate = new AjvJsonSchemaValidator().getValidator(tool.parameters);
    expect(validate(input).valid).toBe(true);
    expect(
      validate({ ...input, questions: Array(2).fill(input.questions[0]) })
        .valid,
    ).toBe(false);
    expect(
      validate({
        ...input,
        questions: [
          {
            ...input.questions[0],
            options: Array(21).fill(input.questions[0]?.options[0]),
          },
        ],
      }).valid,
    ).toBe(false);
    await expect(
      tool.execute(
        { ...input, questions: [...input.questions, ...input.questions] },
        api,
        context,
      ),
    ).rejects.toThrow("每次只能发送一个问题");
    await expect(
      tool.execute({ ...input, attachments: ["f".repeat(64)] }, api, context),
    ).rejects.toThrow();
    const result = await tool.execute(input, api, context);
    expect(JSON.stringify(result)).toContain("sent");
    const saved = await runtime.harness.snapshot(
      QuestionDoc,
      botId,
      "question:123:media",
      context,
    );
    expect(saved?.request?.attachments?.[0]?.id).toBe(file.id);
    expect(
      saved?.request?.questions?.[0]?.options?.[0]?.attachments?.[0]?.id,
    ).toBe(file.id);
    expect((await state())?.approvals ?? []).toHaveLength(0);
    const attention = await runtime.bots.chats.summary({}, context);
    expect(attention.counts[`bot/${botId}`]).toBe(1);
    expect(attention.events).toHaveLength(1);
    expect(attention.events[0]).toMatchObject({
      kind: "question",
      cursor: saved?.cursor,
    });
    expect(
      (await runtime.bots.chats.search("方案 A", undefined, context)).items,
    ).toHaveLength(1);
    await tool.execute(input, api, context);
    const entries = await runtime.conversation.entries(
      {},
      100,
      undefined,
      context,
    );
    expect(
      entries.items.filter(
        (entry) => (entry.data as { approval?: unknown })?.approval,
      ),
    ).toHaveLength(1);
  } finally {
    await runtime.harness.close(context);
  }
});

test("native question batches keep separate cards and retain questions after cancellation and restart", async () => {
  const fixture = await setup();
  let runtime = await fixture.open();
  const computers = {
    preflight: async () => {},
    computerId: async () => "pc",
    tools: { catalog: async () => [], finish: () => {} },
  } as unknown as Computers;
  const execution = new EngineExecution(computers);
  execution.computer = new ComputerRuntime(
    runtime.harness,
    createRegistry(),
    computers,
    runtime.files,
  );
  const engines = new Runtime(runtime.harness, execution);
  const botId = runtime.conversation.id;
  const question = (id: string) => ({
    id,
    title: id,
    options: [{ id: "yes", label: "是" }],
  });
  try {
    const batch = execution.computer.approve(
      botId,
      {
        id: "batch",
        title: "两题",
        detail: "",
        kind: "question",
        requestedAt: 1,
        questions: [question("first"), question("second")],
      },
      new AbortController().signal,
      context,
    );
    await expect
      .poll(
        async () =>
          (await runtime.harness.snapshot(ComputerRequests, botId, context))
            ?.approvals.length,
      )
      .toBe(2);
    await engines.answer(
      botId,
      "batch:q:0",
      { allow: true, answers: { first: ["yes"] } },
      context,
    );
    await engines.answer(
      botId,
      "batch:q:1",
      { allow: true, answers: { second: ["yes"] } },
      context,
    );
    expect(await batch).toEqual({
      allow: true,
      answers: { first: ["yes"], second: ["yes"] },
    });
    expect(
      (await engines.view(botId, context)).messages.filter(
        (message) => message.reply,
      ),
    ).toHaveLength(2);
    expect(
      (await runtime.harness.snapshot(EngineDoc, botId, context))?.tasks ?? [],
    ).toHaveLength(0);
    const controller = new AbortController();
    const pending = execution.computer.approve(
      botId,
      {
        id: "late-native",
        title: "明天回答",
        detail: "",
        kind: "question",
        questions: [question("later")],
      },
      controller.signal,
      context,
    );
    await expect
      .poll(
        async () =>
          (await runtime.harness.snapshot(ComputerRequests, botId, context))
            ?.approvals.length,
      )
      .toBe(1);
    controller.abort();
    expect(await pending).toEqual({ allow: false });
    expect(
      (await engines.view(botId, context)).messages.find(
        (message) => message.approval?.request.id === "late-native",
      )?.approval?.state,
    ).toBe("pending");
    await runtime.harness.close(context);
    runtime = await fixture.open();
    const restored = await runtime.harness.snapshot(
      QuestionDoc,
      botId,
      "late-native",
      context,
    );
    expect(restored?.request?.title).toBe("明天回答");
    expect(restored?.answer).toBeUndefined();
    await runtime.harness.commit(async (tx) => {
      (await tx.doc(ComputerRequests, botId)).approvals = [
        {
          id: "saved-question",
          kind: "question",
          title: "旧问题",
          detail: "",
          questions: [question("old")],
        },
        {
          id: "saved-permission",
          kind: "permission",
          title: "授权",
          detail: "",
        },
      ];
    }, context);
    await migrateRuntime(runtime.harness, botId, context);
    expect(
      (
        await runtime.harness.snapshot(
          QuestionDoc,
          botId,
          "saved-question",
          context,
        )
      )?.request?.title,
    ).toBe("旧问题");
    expect(
      (await runtime.harness.snapshot(ComputerRequests, botId, context))
        ?.approvals,
    ).toEqual([]);
    const view = await Runtime.prototype.view.call(
      { harness: runtime.harness } as unknown as Runtime,
      botId,
      context,
    );
    expect(
      view.messages.find(
        (message) => message.approval?.request.id === "saved-permission",
      )?.approval?.state,
    ).toBe("expired");
    expect(
      view.messages.find(
        (message) => message.approval?.request.id === "late-native",
      )?.approval?.state,
    ).toBe("pending");
  } finally {
    await runtime.harness.close(context);
  }
});

test("draft confirmation returns the edited version and records cancellation", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const execution = new EngineExecution({} as Computers);
  execution.computer = new ComputerRuntime(
    runtime.harness,
    createRegistry(),
    {} as Computers,
    runtime.files,
  );
  const tool = interactionExtension(execution).tools?.[0];
  if (!tool) throw new Error("Draft tool required");
  const api = {
    conversationId: runtime.conversation.id,
    callId: "draft",
  } as Parameters<typeof tool.execute>[1];
  try {
    const result = tool.execute(
      {
        title: "发送邮件",
        confirmLabel: "发送",
        body: "周五开会",
        editable: true,
        fields: [
          {
            id: "to",
            label: "收件人",
            value: "alex@example.com",
            editable: true,
          },
        ],
      },
      api,
      context,
    );
    const state = () =>
      runtime.harness.snapshot(
        ComputerRequests,
        runtime.conversation.id,
        context,
      );
    await expect.poll(async () => (await state())?.approvals.length).toBe(1);
    await execution.computer.answer(
      runtime.conversation.id,
      "draft:draft",
      {
        allow: true,
        answers: { to: ["sam@example.com"], body: ["周五三点开会"] },
      },
      context,
    );
    const confirmed = JSON.stringify(await result);
    expect(confirmed).toContain("周五三点开会");
    expect(confirmed).toContain("sam@example.com");
    const cancelled = tool.execute(
      { title: "发布", confirmLabel: "发布", body: "草稿" },
      { ...api, callId: "cancel" },
      context,
    );
    await expect.poll(async () => (await state())?.approvals.length).toBe(1);
    await execution.computer.answer(
      runtime.conversation.id,
      "draft:cancel",
      { allow: false },
      context,
    );
    expect(JSON.stringify(await cancelled)).toContain("cancelled");
    const controller = new AbortController();
    const stopped = tool.execute(
      { title: "保存草稿", confirmLabel: "保存" },
      { ...api, callId: "stop" },
      withAbortSignal(controller.signal, context),
    );
    await expect.poll(async () => (await state())?.approvals.length).toBe(1);
    controller.abort();
    expect(JSON.stringify(await stopped)).toContain("cancelled");
    await expect(
      execution.computer.answer(
        runtime.conversation.id,
        "draft:stop",
        { allow: true },
        context,
      ),
    ).rejects.toThrow();
  } finally {
    await runtime.harness.close(context);
  }
});

test.each(["http", "stdio"])(
  "%s credential input reaches the existing store but never the card or answer",
  async (transport) => {
    const fixture = await setup();
    const runtime = await fixture.open();
    const records = new Map<string, Credential>();
    const service = new McpConnections(runtime.harness, {
      read: async (id) => records.get(id),
      list: async () => [],
      modify: async (id, update) => {
        const value = await update(records.get(id));
        if (value) records.set(id, value);
        return value;
      },
      delete: async (id) => {
        records.delete(id);
      },
    });
    const execution = new EngineExecution({} as Computers);
    execution.mcp = service;
    execution.computer = new ComputerRuntime(
      runtime.harness,
      createRegistry(),
      {} as Computers,
      runtime.files,
    );
    let connection = await service.save(
      {
        id: crypto.randomUUID(),
        revision: 0,
        name: "Notes",
        computerId: "pc",
        enabled: true,
        config:
          transport === "http"
            ? {
                transport: "http",
                url: "https://example.com/mcp",
                headers: {},
              }
            : { transport: "stdio", command: "fixture", args: [], env: {} },
      },
      context,
    );
    connection = await service.grant(
      connection.id,
      connection.revision,
      [{ botId: runtime.conversation.id, tools: null }],
      context,
    );
    const tool = interactionExtension(execution).tools?.[1];
    if (!tool) throw new Error("Credential tool required");
    const api = {
      conversationId: runtime.conversation.id,
      callId: "secret",
    } as Parameters<typeof tool.execute>[1];
    try {
      const result = tool.execute(
        {
          connectionId: connection.id,
          mode: "secret",
          fields: [
            { name: "Authorization", label: "API Key", prefix: "Bearer " },
          ],
        },
        api,
        context,
      );
      const state = () =>
        runtime.harness.snapshot(
          ComputerRequests,
          runtime.conversation.id,
          context,
        );
      await expect.poll(async () => (await state())?.approvals.length).toBe(1);
      await expect(
        execution.computer.answer(
          runtime.conversation.id,
          "credential:secret",
          { allow: true, text: "leaked" },
          context,
        ),
      ).rejects.toThrow();
      await expect(
        completeCredentials(
          execution,
          runtime.conversation.id + 1,
          "credential:secret",
          { Authorization: "private-value" },
          context,
        ),
      ).rejects.toThrow();
      for (const value of transport === "http"
        ? ["invalid\r\nheader", "invalid\0header"]
        : ["invalid\0value"])
        await expect(
          completeCredentials(
            execution,
            runtime.conversation.id,
            "credential:secret",
            { Authorization: value },
            context,
          ),
        ).rejects.toThrow("格式");
      await completeCredentials(
        execution,
        runtime.conversation.id,
        "credential:secret",
        { Authorization: "private-value" },
        context,
      );
      const answer = JSON.stringify(await result);
      expect(answer).toContain("configured");
      expect(answer).not.toContain("private-value");
      expect(JSON.stringify(await state())).not.toContain("private-value");
      expect(
        JSON.stringify(
          await runtime.conversation.entries({}, 100, undefined, context),
        ),
      ).not.toContain("private-value");
      const resolved = await service.resolve(
        connection.id,
        runtime.conversation.id,
        "pc",
        context,
      );
      expect(
        resolved.config.transport === "http"
          ? resolved.config.headers.Authorization
          : resolved.config.env.Authorization,
      ).toBe("Bearer private-value");
      await expect(
        completeCredentials(
          execution,
          runtime.conversation.id,
          "credential:secret",
          { Authorization: "again" },
          context,
        ),
      ).rejects.toThrow();
    } finally {
      await runtime.harness.close(context);
    }
  },
);

test.each(["pi", "codex", "claude", "opencode", "acp"])(
  "%s discovers shared interactions and receives draft and question answers",
  async (provider) => {
    const directory = await mkdtemp(join(tmpdir(), "domos-interactions-"));
    const models = createModels();
    models.setProvider(fauxProvider().provider);
    let invoke!: (
      id: string,
      name: string,
      args: Record<string, unknown>,
      signal: AbortSignal,
    ) => Promise<ProductResult>;
    let discovered = false;
    let turns = 0;
    const nativeAnswers = vi.fn(async () => {});
    const computers = {
      preflight: async () => {},
      computerId: async () => "pc",
      binding: async () => ({ computerId: "pc", revision: 0 }),
      tools: { catalog: async () => [], finish: () => {} },
      process: async (
        _id: number,
        tools: { name: string }[],
        callback: typeof invoke,
      ) => {
        discovered = [
          "review_draft",
          "request_credentials",
          "ask_question",
          "send_link_card",
          "mcp_call",
        ].every((name) => tools.some((tool) => tool.name === name));
        invoke = callback;
        return new ProtocolProcess();
      },
    } as unknown as Computers;
    const execution = new EngineExecution(computers);
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: "domos-engines",
        tasks: [engineTask(execution)],
      }),
    );
    registry.install(execution.mcpExtension());
    registry.install(interactionExtension(execution));
    const received = Promise.withResolvers<ProductResult>();
    const questionResult = Promise.withResolvers<ProductResult>();
    const opened = vi
      .spyOn(engineProvider(provider), "open")
      .mockImplementation(async (options) => {
        expect(options.instructions).toContain("use ask_question rather than");
        expect(options.instructions).toContain("use send_link_card with");
        expect(options.instructions).toContain("Use review_draft");
        expect(options.instructions).toContain("Use request_credentials");
        return {
          id: provider,
          prompt: async () => {
            if (++turns > 1) {
              await options.emit({ type: "accepted", id: "reply" });
              return;
            }
            await options.emit({ type: "accepted", id: "turn" });
            const link = {
              url: "https://example.com/report",
              label: "打开本次报告",
              body: "报告已准备好。",
              title: "检查结果",
              footer: "保留原始资料。",
            };
            await invoke(
              "link",
              "send_link_card",
              link,
              new AbortController().signal,
            );
            await invoke(
              "link",
              "send_link_card",
              link,
              new AbortController().signal,
            );
            received.resolve(
              await invoke(
                "draft",
                "review_draft",
                {
                  title: "发布更新",
                  confirmLabel: "发布",
                  body: "原稿",
                  editable: true,
                },
                new AbortController().signal,
              ),
            );
            questionResult.resolve(
              await invoke(
                "question",
                "ask_question",
                {
                  title: "选择发布渠道",
                  questions: [
                    {
                      id: "channel",
                      title: "选择发布渠道",
                      options: [
                        { id: "web", label: "网页" },
                        { id: "desktop", label: "桌面" },
                      ],
                    },
                  ],
                },
                new AbortController().signal,
              ),
            );
            await options.emit({
              type: "message",
              id: "reply",
              text: "已收到确认稿。",
            });
            await options.emit({
              type: "approval",
              approval: {
                id: "native-batch",
                kind: "question",
                title: "原生问题",
                detail: "",
                questions: [
                  {
                    id: "first",
                    title: "第一题",
                    options: [{ id: "yes", label: "是" }],
                  },
                  {
                    id: "second",
                    title: "第二题",
                    options: [{ id: "yes", label: "是" }],
                  },
                ],
              },
            });
            await expect
              .poll(
                async () =>
                  (
                    await runtime.harness.snapshot(
                      ComputerRequests,
                      botId,
                      context,
                    )
                  )?.approvals.length,
              )
              .toBe(2);
            await options.emit({ type: "approval_closed", id: "native-batch" });
            await expect
              .poll(
                async () =>
                  (
                    await runtime.harness.snapshot(
                      ComputerRequests,
                      botId,
                      context,
                    )
                  )?.approvals.length,
              )
              .toBe(0);
          },
          answer: nativeAnswers,
          interrupt: async () => {},
          models: async () => [],
        };
      });
    let runtime = await openAgent(
      join(directory, "data.sqlite"),
      { registry, models },
      {},
      context,
    );
    const botId = runtime.conversation.id;
    execution.computer = new ComputerRuntime(
      runtime.harness,
      registry,
      computers,
      runtime.files,
    );
    let engines = new Runtime(runtime.harness, execution);
    try {
      await runtime.harness.commit(async (tx) => {
        (await tx.doc(EngineDoc, botId)).config = { provider, model: null };
      }, context);
      await engines.submit(
        botId,
        { text: "写一份更新，先让我看", requestId: crypto.randomUUID() },
        context,
      );
      await expect
        .poll(
          async () =>
            (await runtime.harness.snapshot(ComputerRequests, botId, context))
              ?.approvals.length,
        )
        .toBe(1);
      expect(discovered).toBe(true);
      const links = (await engines.view(botId, context)).messages.filter(
        (message) => message.link,
      );
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({
        role: "assistant",
        link: { url: "https://example.com/report", label: "打开本次报告" },
        toolStatus: "done",
      });
      expect(links[0] && messageText(links[0])).toContain("打开本次报告");
      expect(
        (await runtime.bots.chats.search("本次报告", undefined, context)).items,
      ).toHaveLength(1);
      await engines.answer(
        botId,
        "draft:draft",
        { allow: true, answers: { body: ["确认稿"] } },
        context,
      );
      expect(JSON.stringify(await received.promise)).toContain("确认稿");
      const questionReply = await questionResult.promise;
      expect(JSON.stringify(questionReply)).toContain("sent");
      const content = questionReply.content[0];
      if (content?.type !== "text") throw new Error("题卡回执缺少文本。");
      const { questionId } = JSON.parse(content.text) as { questionId: string };
      await expect
        .poll(async () => (await engines.view(botId, context)).busy)
        .toBe(false);
      const question = await runtime.harness.snapshot(
        QuestionDoc,
        botId,
        questionId,
        context,
      );
      expect(question?.request?.questions).toHaveLength(1);
      expect(question?.answer).toBeUndefined();
      expect(nativeAnswers).not.toHaveBeenCalled();
      const batchCards = (await engines.view(botId, context)).messages.filter(
        (message) => message.approval?.request.id.startsWith("native-batch:q:"),
      );
      expect(batchCards).toHaveLength(2);
      expect(
        batchCards.every((message) => message.approval?.state === "pending"),
      ).toBe(true);
      await execution.stop(botId);
      await runtime.harness.close(context);
      runtime = await openAgent(
        join(directory, "data.sqlite"),
        { registry, models },
        {},
        context,
      );
      execution.computer = new ComputerRuntime(
        runtime.harness,
        registry,
        computers,
        runtime.files,
      );
      engines = new Runtime(runtime.harness, execution);
      expect(
        (
          await runtime.harness.snapshot(
            QuestionDoc,
            botId,
            questionId,
            context,
          )
        )?.answer,
      ).toBeUndefined();
      const answer = { allow: true, answers: { channel: ["desktop"] } };
      await expect(
        engines.answer(
          botId,
          questionId,
          { allow: true, answers: { channel: ["unknown"] } },
          context,
        ),
      ).rejects.toThrow();
      await Promise.all([
        engines.answer(botId, questionId, answer, context),
        engines.answer(botId, questionId, answer, context),
      ]);
      await expect.poll(() => turns).toBe(2);
      await expect
        .poll(async () => (await engines.view(botId, context)).busy)
        .toBe(false);
      const view = await engines.view(botId, context);
      expect(
        view.messages.find(
          (message) => message.approval?.request.id === questionId,
        )?.approval?.state,
      ).toBe("answered");
      expect(view.messages.filter((message) => message.reply)).toHaveLength(1);
      expect(view.messages.find((message) => message.reply)).toMatchObject({
        role: "user",
        content: [{ text: "桌面" }],
        reply: { title: "选择发布渠道" },
      });

      const persisted = await runtime.conversation.entries(
        {},
        100,
        undefined,
        context,
      );
      expect(
        persisted.items.filter(
          (entry) => (entry.data as { link?: unknown })?.link,
        ),
      ).toHaveLength(1);
      expect(links[0]?.id).toMatch(/^product:/);
    } finally {
      await execution.stop(botId);
      await runtime.harness.close(context);
      opened.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("credential setup reconnects the current MCP task using native transport", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const records = new Map<string, Credential>();
  const service = new McpConnections(runtime.harness, {
    read: async (id) => records.get(id),
    list: async () => [],
    modify: async (id, update) => {
      const value = await update(records.get(id));
      if (value) records.set(id, value);
      return value;
    },
    delete: async (id) => {
      records.delete(id);
    },
  });
  const upstream = await mcpFixture({ oauth: true });
  service.runner = async (_computerId, input, signal) =>
    mcpOperation(input, signal);
  const execution = new EngineExecution({
    binding: async () => ({ computerId: "pc", revision: 0 }),
  } as unknown as Computers);
  execution.mcp = service;
  execution.computer = new ComputerRuntime(
    runtime.harness,
    createRegistry(),
    {} as Computers,
    runtime.files,
  );
  const worker = new ProtocolProcess();
  worker.mcp = async <T>(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) =>
    (await mcpOperation(
      input as Parameters<typeof mcpOperation>[0],
      signal,
    )) as T;
  const botId = runtime.conversation.id;
  execution.active.set(botId, {
    process: worker,
    controller: new AbortController(),
    memoryReview: false,
    approve: async () => ({ allow: true }),
  });
  const id = crypto.randomUUID();
  try {
    let item = await service.save(
      {
        id,
        revision: 0,
        name: "Notes",
        computerId: "pc",
        enabled: true,
        config: { transport: "http", url: upstream.url, headers: {} },
      },
      context,
    );
    item = await service.grant(
      id,
      item.revision,
      [{ botId, tools: null }],
      context,
    );
    const call = execution.mcpExtension().tools?.[0];
    const credential = interactionExtension(execution).tools[1];
    if (!call) throw new Error("MCP tool required");
    const api = {
      conversationId: botId,
      callId: "oauth",
      snapshot: (...args: Parameters<typeof runtime.harness.snapshot>) =>
        runtime.harness.snapshot(...args),
    } as Parameters<typeof call.execute>[1];
    const input = { id, requestId: "list", method: "tools/list", params: {} };
    await expect(call.execute(input, api, context)).rejects.toThrow();
    const waiting = credential.execute(
      { connectionId: id, mode: "oauth" },
      api,
      context,
    );
    await expect
      .poll(
        async () =>
          (await runtime.harness.snapshot(ComputerRequests, botId, context))
            ?.approvals.length,
      )
      .toBe(1);
    await expect(
      completeCredentials(execution, botId, "credential:oauth", {}, context),
    ).rejects.toThrow("授权");
    const login = await service.login(
      id,
      "http://127.0.0.1:34567/mcp/oauth/callback",
      undefined,
      context,
    );
    await upstream.authorize(String(login.url));
    await service.complete(
      new URL(String(login.url)).searchParams.get("state") ?? "",
      "fixture-code",
      context,
    );
    await completeCredentials(
      execution,
      botId,
      "credential:oauth",
      {},
      context,
    );
    expect(JSON.stringify(await waiting)).toContain("configured");
    expect(JSON.stringify(await call.execute(input, api, context))).toContain(
      "read",
    );
    expect(
      JSON.stringify(
        await call.execute(
          {
            id,
            requestId: "read",
            method: "tools/call",
            params: { name: "read", arguments: {} },
          },
          api,
          context,
        ),
      ),
    ).toContain("native");
  } finally {
    await mcpOperation({ action: "disconnect", id });
    await worker.close();
    await upstream.close();
    await runtime.harness.close(context);
  }
});
