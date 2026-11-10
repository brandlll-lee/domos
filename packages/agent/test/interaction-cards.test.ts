import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAbortSignal } from "@earendil-works/chord/context";
import type { Credential } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, defineExtension } from "@earendil-works/pi-durable";
import { expect, test, vi } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { ComputerRequests, ComputerRuntime } from "../src/computer/runtime.ts";
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
import { openAgent } from "../src/open-agent.ts";
import { engineTask, Runtime } from "../src/runtime/index.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";
import { mcpFixture } from "./fixtures/mcp.mjs";
import { context, setup } from "./fixtures/work.ts";

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
  "%s discovers the shared draft tool and receives its confirmed revision",
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
        discovered = ["review_draft", "request_credentials", "mcp_call"].every(
          (name) => tools.some((tool) => tool.name === name),
        );
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
    const opened = vi
      .spyOn(engineProvider(provider), "open")
      .mockImplementation(async (options) => ({
        id: provider,
        prompt: async () => {
          await options.emit({ type: "accepted", id: "turn" });
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
          await options.emit({
            type: "message",
            id: "reply",
            text: "已收到确认稿。",
          });
        },
        answer: async () => {},
        interrupt: async () => {},
        models: async () => [],
      }));
    const runtime = await openAgent(
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
    const engines = new Runtime(runtime.harness, execution);
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
      await engines.answer(
        botId,
        "draft:draft",
        { allow: true, answers: { body: ["确认稿"] } },
        context,
      );
      expect(JSON.stringify(await received.promise)).toContain("确认稿");
      await expect
        .poll(async () => (await engines.view(botId, context)).busy)
        .toBe(false);
      expect(
        (await engines.view(botId, context)).messages.find(
          (item) => item.approval,
        )?.approval?.state,
      ).toBe("answered");
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
