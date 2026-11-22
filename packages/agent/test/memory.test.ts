import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "vitest";
import { conversationEntry } from "../src/harness/history.ts";
import { EngineMessage } from "../src/harness/state.ts";
import {
  deleteMemory,
  MemoryReviewDoc,
  memoryContext,
  memoryGeneration,
  memoryUsage,
  saveMemory,
} from "../src/work/memory.ts";
import { agent, context, setup } from "./fixtures/work.ts";

test("deleted memory rejects a stale writer after reopening the database", async () => {
  const f = await setup();
  const first = await f.open();
  const botId = first.conversation.id;
  const input = {
    id: "city",
    text: "居住在北京",
    category: "profile" as const,
    shared: false,
    revision: 0,
    requestId: "initial",
  };
  const saved = await first.work.memory.save(botId, input, context);
  await first.work.memory.delete(botId, saved.id, saved.revision, context);
  await first.harness.close(context);
  const second = await f.open();
  try {
    await expect(
      second.harness.commit(
        (tx) =>
          saveMemory(tx, botId, { ...input, requestId: "stale" }, "bot:review"),
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await second.work.memory.list(botId, context)).toEqual([]);
  } finally {
    await second.harness.close(context);
  }
});

test("in-place correction retains historical evidence and validates source identity", async () => {
  const f = await setup();
  const runtime = await f.open();
  const botId = runtime.conversation.id;
  try {
    const refs = await runtime.harness.commit(async (tx) => {
      const refs = [];
      for (const text of ["去年住在北京", "从2026-11-20起我住在上海"]) {
        const entry = await tx.appendEntry(botId, {
          kind: EngineMessage,
          data: { id: text, role: "user", content: [{ type: "text", text }] },
        });
        refs.push({ conversationId: botId, entryId: entry.id, quote: text });
      }
      return refs;
    }, context);
    const [beijing, shanghai] = refs;
    if (!beijing || !shanghai) throw new Error("Expected two source records");
    const input = {
      id: "city",
      text: "居住在北京",
      category: "profile" as const,
      shared: false,
      revision: 0,
      requestId: "beijing",
      origin: "user" as const,
      evidence: [beijing],
    };
    const old = await runtime.harness.commit(
      (tx) => saveMemory(tx, botId, input, "bot:tool"),
      context,
    );
    if (!("revision" in old)) throw new Error("Expected confirmed memory");
    const change = {
      ...input,
      id: old.id,
      revision: old.revision,
      text: "居住在上海",
      requestId: "shanghai",
      evidence: [shanghai],
    };
    await runtime.harness.commit(
      (tx) => saveMemory(tx, botId, change, "bot:tool"),
      context,
    );
    expect(await runtime.work.memory.list(botId, context)).toMatchObject([
      {
        text: "居住在上海",
        origin: "user",
        id: "city",
        revision: 2,
      },
    ]);
    expect(
      await runtime.work.memory.evidence(botId, "city", 0, context),
    ).toMatchObject({
      conversationId: botId,
      entryId: shanghai.entryId,
      chat: `bot/${botId}`,
      messageId: shanghai.quote,
    });
    expect(
      await conversationEntry(
        {
          conversationId: botId,
          commit: runtime.harness.commit.bind(runtime.harness),
        },
        beijing.entryId,
        0,
        context,
      ),
    ).toContain("去年住在北京");
    await expect(
      runtime.harness.commit(
        (tx) =>
          saveMemory(tx, botId, { ...input, requestId: "stale" }, "bot:tool"),
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      runtime.harness.commit(
        (tx) =>
          saveMemory(
            tx,
            botId,
            {
              ...input,
              id: "forged",
              evidence: [{ ...beijing, quote: "我住在广州" }],
            },
            "bot:tool",
          ),
        context,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const other = await runtime.bots.create(
      {
        name: "Other",
        instructions: "",
        model: agent.model,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    await expect(
      runtime.harness.commit(
        (tx) =>
          saveMemory(tx, other.id, { ...input, id: "foreign" }, "bot:tool"),
        context,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const shared = await runtime.harness.commit(
      (tx) =>
        saveMemory(
          tx,
          botId,
          { ...input, id: "shared", shared: true },
          "bot:tool",
        ),
      context,
    );
    if (!("id" in shared)) throw new Error("Expected memory");
    expect(
      (await runtime.work.memory.list(other.id, context))[0]?.evidence,
    ).toEqual([]);
    await expect(
      runtime.work.memory.evidence(other.id, shared.id, 0, context),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const observation = await runtime.harness.commit(async (tx) => {
      const entry = await tx.appendEntry(botId, {
        kind: EngineMessage,
        data: {
          id: "observation",
          turnId: "engine:observation",
          role: "toolResult",
          toolName: "inspect",
          toolCallId: "inspect",
          content: [{ type: "text", text: "服务返回 204" }],
        },
      });
      return {
        conversationId: botId,
        entryId: entry.id,
        quote: "服务返回 204",
      };
    }, context);
    await runtime.harness.commit(
      (tx) =>
        saveMemory(
          tx,
          botId,
          {
            ...input,
            id: "observed",
            text: "服务返回 204",
            origin: "tool",
            evidence: [observation],
          },
          "bot:tool",
        ),
      context,
    );
    expect(
      await runtime.work.memory.evidence(botId, "observed", 0, context),
    ).toMatchObject({ turnId: "engine:observation" });
  } finally {
    await runtime.harness.close(context);
  }
});

test("background deletion barriers skip old IDs, text and sources after restart", async () => {
  const f = await setup();
  const first = await f.open();
  const botId = first.conversation.id;
  const ref = await first.harness.commit(async (tx) => {
    const entry = await tx.appendEntry(botId, {
      kind: EngineMessage,
      data: {
        id: "city-source",
        role: "user",
        content: [{ type: "text", text: "我住在北京" }],
      },
    });
    return { conversationId: botId, entryId: entry.id, quote: "我住在北京" };
  }, context);
  const input = {
    id: "city",
    text: "住在北京",
    shared: false,
    revision: 0,
    requestId: "saved",
    origin: "user" as const,
    evidence: [ref],
  };
  await first.harness.commit(
    (tx) => saveMemory(tx, botId, input, "bot:tool"),
    context,
  );
  await first.work.memory.delete(botId, "city", 1, context);
  await first.harness.close(context);
  const reopened = await f.open();
  try {
    for (const change of [
      { id: "city", revision: 0 },
      { id: "city", revision: 2 },
      { id: "same-text", text: "住在北京" },
      { id: "same-source", text: "北京是常住地" },
    ]) {
      expect(
        await reopened.harness.commit(
          (tx) =>
            saveMemory(
              tx,
              botId,
              { ...input, ...change, requestId: change.id },
              "bot:review",
              botId,
              true,
            ),
          context,
        ),
      ).toEqual({ skipped: true });
    }
    expect(await reopened.work.memory.list(botId, context)).toEqual([]);
  } finally {
    await reopened.harness.close(context);
  }
});

test("confirmed tool memory survives a later task failure and database restart", async () => {
  const f = await setup();
  const first = await f.open();
  const botId = first.conversation.id;
  f.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("memory_save", {
        text: "回复用简体中文",
        revision: 0,
        category: "profile",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "provider interrupted",
    }),
  ]);
  try {
    await (
      await first.conversation.submit(
        { type: "input", content: "请记住，回复用简体中文" },
        context,
      )
    ).wait(context);
    expect(await first.work.memory.list(botId, context)).toMatchObject([
      {
        text: "回复用简体中文",
        origin: "inference",
        evidence: [],
      },
    ]);
  } finally {
    await first.harness.close(context);
  }
  const reopened = await f.open();
  try {
    expect(await reopened.work.memory.list(botId, context)).toHaveLength(1);
  } finally {
    await reopened.harness.close(context);
  }
});

test("alternative queries retrieve notes and empty memory search reads authorized chat", async () => {
  const f = await setup();
  const runtime = await f.open();
  const botId = runtime.conversation.id;
  try {
    await runtime.work.memory.save(
      botId,
      {
        id: "note",
        text: "附件删除后立即更新界面",
        category: "work",
        shared: false,
        revision: 0,
        requestId: "note",
      },
      context,
    );
    await runtime.harness.commit(async (tx) => {
      await tx.appendEntry(botId, {
        kind: EngineMessage,
        data: {
          id: "old-city",
          role: "user",
          content: [{ type: "text", text: "去年住在北京" }],
        },
      });
    }, context);
    f.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("memory_search", { queries: ["移除文件", "附件删除"] }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("memory_search", { queries: ["去年", "北京"] }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Checked"),
    ]);
    await (
      await runtime.conversation.submit(
        { type: "input", content: "查找附件规则和旧住址" },
        context,
      )
    ).wait(context);
    const results = (
      await runtime.conversation.context(context)
    ).messages.filter(
      (message) =>
        message.role === "toolResult" && message.toolName === "memory_search",
    );
    expect(JSON.stringify(results[0])).toContain("附件删除后立即更新界面");
    expect(JSON.stringify(results[1])).toContain("去年住在北京");
  } finally {
    await runtime.harness.close(context);
  }
});

test("background upkeep saves directly and skips protected, uncertain and stale changes", async () => {
  const f = await setup();
  const runtime = await f.open();
  const botId = runtime.conversation.id;
  const input = {
    id: "units",
    text: "报告使用公制单位",
    category: "profile" as const,
    shared: false,
    revision: 0,
    requestId: "units",
  };
  try {
    const ref = await runtime.harness.commit(async (tx) => {
      const entry = await tx.appendEntry(botId, {
        kind: EngineMessage,
        data: {
          id: "source",
          role: "user",
          content: [
            { type: "text", text: "报告使用公制单位，金额使用人民币。" },
          ],
        },
      });
      const review = await tx.doc(MemoryReviewDoc, botId);
      review.reviewing = true;
      review.generation = await memoryGeneration(tx, botId);
      return {
        conversationId: botId,
        entryId: entry.id,
        quote: "报告使用公制单位，金额使用人民币。",
      };
    }, context);
    const write = (
      change: Partial<typeof input>,
      origin: "user" | "inference" = "user",
    ) =>
      runtime.harness.commit(
        (tx) =>
          saveMemory(
            tx,
            botId,
            { ...input, ...change, origin, evidence: [ref] },
            "bot:review",
            botId,
            true,
          ),
        context,
      );
    expect(await write({})).toMatchObject({ id: "units", revision: 1 });
    expect(
      await write({
        id: "currency",
        text: "金额使用人民币",
        requestId: "currency",
      }),
    ).toMatchObject({ id: "currency", revision: 1 });
    expect(
      await write({
        revision: 1,
        text: "报告采用公制单位",
        requestId: "update",
      }),
    ).toMatchObject({ id: "units", revision: 2 });
    expect(await write({ revision: 1, requestId: "stale" })).toEqual({
      skipped: true,
    });
    expect(
      await write({ id: "guess", requestId: "guess" }, "inference"),
    ).toEqual({ skipped: true });
    expect(
      await runtime.harness.commit(
        (tx) =>
          saveMemory(
            tx,
            botId,
            { ...input, id: "unsupported", origin: "user" },
            "bot:review",
            botId,
            true,
          ),
        context,
      ),
    ).toEqual({ skipped: true });
    const current = await runtime.work.memory.list(botId, context);
    const contextText = memoryContext(current, botId)
      .split("\n")
      .slice(1)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(contextText.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      current
        .map((item) => ({ id: item.id, text: item.text }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(memoryUsage(current)).toEqual(
      memoryUsage(current.map((item) => ({ ...item, evidence: [] }))),
    );
    await runtime.work.memory.save(
      botId,
      { ...input, id: "manual", requestId: "manual" },
      context,
    );
    await runtime.harness.commit(async (tx) => {
      (await tx.doc(MemoryReviewDoc, botId)).generation =
        await memoryGeneration(tx, botId);
    }, context);
    expect(
      await write({ id: "manual", revision: 1, requestId: "overwrite" }),
    ).toEqual({ skipped: true });
    await runtime.harness.commit(
      (tx) => deleteMemory(tx, botId, "manual", 1, "bot:review"),
      context,
    );
    expect(
      (await runtime.work.memory.list(botId, context)).find(
        (item) => item.id === "manual",
      ),
    ).toMatchObject({ text: input.text, revision: 1 });
    await runtime.work.memory.save(
      botId,
      { ...input, id: "manual", revision: 1, requestId: "edited" },
      context,
    );
    expect(await write({ id: "late", requestId: "late" })).toEqual({
      skipped: true,
    });
    expect(await runtime.work.memory.list(botId, context)).toHaveLength(3);
  } finally {
    await runtime.harness.close(context);
  }
});
