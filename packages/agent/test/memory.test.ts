import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "vitest";
import { conversationEntry } from "../src/harness/history.ts";
import { EngineMessage } from "../src/harness/state.ts";
import { MemoryDoc, MemoryReviewDoc, saveMemory } from "../src/work/memory.ts";
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

test("fact replacement retains historical evidence and validates source identity", async () => {
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
      id: "new-city",
      text: "居住在上海",
      requestId: "shanghai",
      evidence: [shanghai],
      effectiveAt: "2026-11-20",
      replaces: { id: old.id, revision: old.revision },
    };
    await runtime.harness.commit(
      (tx) => saveMemory(tx, botId, change, "bot:tool"),
      context,
    );
    expect(await runtime.work.memory.list(botId, context)).toMatchObject([
      {
        text: "居住在上海",
        origin: "user",
        effectiveAt: "2026-11-20",
        replaces: { id: "city", revision: 1 },
      },
    ]);
    expect(
      await runtime.work.memory.evidence(botId, "new-city", 0, context),
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
    await expect(
      runtime.harness.commit(
        (tx) =>
          saveMemory(
            tx,
            botId,
            { ...input, id: "dated", effectiveAt: "2026-11-20" },
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

test("deletion invalidates review proposals and prevents relearning from the same source", async () => {
  const f = await setup();
  const runtime = await f.open();
  const botId = runtime.conversation.id;
  try {
    const ref = await runtime.harness.commit(async (tx) => {
      const entry = await tx.appendEntry(botId, {
        kind: EngineMessage,
        data: {
          id: "source",
          role: "user",
          content: [{ type: "text", text: "我住在北京" }],
        },
      });
      return { conversationId: botId, entryId: entry.id, quote: "我住在北京" };
    }, context);
    const input = {
      id: "city",
      text: "住在北京",
      category: "profile" as const,
      shared: false,
      revision: 0,
      requestId: "saved",
      evidence: [ref],
      origin: "user" as const,
    };
    await runtime.harness.commit(
      (tx) => saveMemory(tx, botId, input, "bot:tool"),
      context,
    );
    await runtime.harness.commit(async (tx) => {
      (await tx.doc(MemoryReviewDoc, botId)).reviewing = true;
      await saveMemory(
        tx,
        botId,
        {
          ...input,
          id: "proposal",
          text: "常住地北京",
          requestId: "candidate",
        },
        "bot:review",
      );
    }, context);
    await runtime.work.memory.delete(botId, "city", 1, context);
    await expect(
      runtime.work.memory.resolve(botId, "candidate", true, context),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      runtime.harness.commit(
        (tx) =>
          saveMemory(
            tx,
            botId,
            {
              ...input,
              id: "resurrection",
              text: "北京是居住地",
              requestId: "again",
            },
            "bot:review",
          ),
        context,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await runtime.work.memory.resolve(botId, "candidate", false, context);
    await runtime.harness.commit(async (tx) => {
      (await tx.doc(MemoryReviewDoc, botId)).reviewing = false;
    }, context);
    expect(
      await runtime.harness.commit(
        (tx) =>
          saveMemory(
            tx,
            botId,
            { ...input, id: "restored", requestId: "confirm" },
            "bot:tool",
          ),
        context,
      ),
    ).toMatchObject({ pending: true });
    await runtime.work.memory.resolve(botId, "confirm", true, context);
    expect(await runtime.work.memory.list(botId, context)).toMatchObject([
      { id: "restored", userAuthored: true },
    ]);
  } finally {
    await runtime.harness.close(context);
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
        evidence: [{ quote: "请记住，回复用简体中文" }],
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

test("background additions remain proposals and do not change a manual profile", async () => {
  const f = await setup();
  const runtime = await f.open();
  const botId = runtime.conversation.id;
  try {
    const input = {
      id: "city",
      text: "居住在北京",
      category: "profile" as const,
      shared: false,
      revision: 0,
      requestId: "manual",
    };
    await runtime.work.memory.save(botId, input, context);
    await runtime.harness.commit(async (tx) => {
      (await tx.doc(MemoryReviewDoc, botId)).reviewing = true;
      await saveMemory(
        tx,
        botId,
        {
          ...input,
          id: "new-city",
          text: "当前常住地是上海",
          requestId: "review",
        },
        "bot:review",
      );
    }, context);
    expect(
      (await runtime.work.memory.list(botId, context)).map((x) => x.text),
    ).toEqual(["居住在北京"]);
    expect(
      (await runtime.harness.snapshot(MemoryDoc, context))?.candidates,
    ).toHaveLength(1);
  } finally {
    await runtime.harness.close(context);
  }
});
