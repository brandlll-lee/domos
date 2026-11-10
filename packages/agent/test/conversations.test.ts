import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ConversationId } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import {
  BotSession,
  createBotSession,
  owningBot,
} from "../src/conversations.ts";
import { EngineDoc } from "../src/harness/state.ts";
import { runtimeFixture } from "./fixtures/runtime.ts";

test("work conversations retain their Bot configuration and separate history", async () => {
  const { harness, conversation, bots } = await runtimeFixture();
  const peer = await bots.create(
    { name: "Reviewer", instructions: "Review changes", requestId: "reviewer" },
    context,
  );
  await harness.commit(async (tx) => {
    (await tx.doc(EngineDoc, peer.id)).config = {
      provider: "codex",
      model: "review-model",
    };
  }, context);
  const id = await createBotSession(
    harness,
    peer.id,
    { purpose: "delegation", origin: conversation.id },
    context,
  );
  expect(id).not.toBe(peer.id);
  expect(await owningBot(harness, id, context)).toBe(peer.id);
  expect(await owningBot(harness, conversation.id, context)).toBe(
    conversation.id,
  );
  expect(await harness.snapshot(BotSession, id, context)).toMatchObject({
    botId: peer.id,
    purpose: "delegation",
    origin: conversation.id,
  });
  expect((await harness.snapshot(EngineDoc, id, context))?.config).toEqual({
    provider: "codex",
    model: "review-model",
  });
  const session = await harness.conversation(id, context);
  assert(session);
  expect((await session.agent(context)).instructions).toBe("Review changes");
  expect(
    (await session.entries({}, 10, undefined, context)).items,
  ).toHaveLength(0);
  await expect(
    createBotSession(
      harness,
      999999 as ConversationId,
      { purpose: "delegation" },
      context,
    ),
  ).rejects.toThrow();
});
