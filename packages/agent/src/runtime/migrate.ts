import type { Context } from "@earendil-works/chord/context";
import {
  AgentDoc,
  type ConversationId,
  defineDoc,
  type Harness,
  type SubmissionId,
} from "@earendil-works/pi-durable";
import { ComputerRequests } from "../computer/runtime.ts";
import { EngineDoc, EngineMessage } from "../harness/state.ts";
import { approvalMessage } from "../messages.ts";
import { stopChat } from "../stop-chat.ts";

const RuntimeMigration = defineDoc<{ complete: boolean }>({
  kind: "domos.native-runtime",
  version: 1,
  checkpointWhen: () => false,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ complete: false }),
});

export async function migrateRuntime(
  harness: Harness,
  botId: ConversationId,
  context: Context,
) {
  const conversation = await harness.conversation(botId, context);
  if (!conversation) return;
  const requests = await harness.snapshot(ComputerRequests, botId, context);
  if (requests?.approvals.length)
    await harness.commit(async (tx) => {
      for (const approval of (await tx.doc(ComputerRequests, botId))
        .approvals) {
        await tx.appendEntry(botId, {
          kind: EngineMessage,
          data: JSON.parse(
            JSON.stringify(approvalMessage(approval, "expired")),
          ),
        });
      }
      (await tx.doc(ComputerRequests, botId)).approvals = [];
    }, context);
  if ((await harness.snapshot(RuntimeMigration, botId, context))?.complete)
    return;
  await stopChat(conversation, context);
  const previous = await harness.snapshot(EngineDoc, botId, context);
  if (previous?.tasks.length) {
    for (const id of previous.tasks) await harness.abortTask(id, context);
    for (const id of previous.tasks) await harness.waitForTask(id, context);
  }
  await harness.commit(async (tx) => {
    const state = await tx.doc(EngineDoc, botId);
    for (const id of state.tasks) {
      const task = await tx.task(id);
      const input = task?.input as { submissionId?: SubmissionId } | undefined;
      if (input?.submissionId)
        tx.settleSubmission(input.submissionId, {
          status: "unanswered",
          reason: "执行结果未确认。请核对后再发送。",
        });
    }
    for (const draft of state.drafts)
      await tx.appendEntry(botId, {
        kind: EngineMessage,
        data: JSON.parse(
          JSON.stringify({
            ...draft,
            pending: false,
            stopped: true,
            ...(draft.takeover
              ? { takeover: { ...draft.takeover, state: "expired" } }
              : {}),
          }),
        ),
      });
    state.tasks = [];
    state.taskId = null;
    state.activeId = null;
    state.activeTurn = null;
    state.drafts = [];
  }, context);
  await harness.commit(async (tx) => {
    const progress = await tx.doc(RuntimeMigration, botId);
    if (progress.complete) return;
    const agent = await tx.doc(AgentDoc, botId);
    const state = await tx.doc(EngineDoc, botId);
    state.config = {
      provider: "pi",
      model: agent.model
        ? `${agent.model.provider}/${agent.model.modelId}`
        : null,
      options: agent.thinkingLevel
        ? { thinkingLevel: agent.thinkingLevel }
        : {},
    };
    state.sessionId = null;
    delete state.sessionKey;
    state.sessions = {};
    state.turnId = null;
    state.dispatch = "ready";
    state.prepared = false;
    state.runtime = {};
    state.prompt = null;
    state.error = null;
    if (previous) state.revision++;
    progress.complete = true;
  }, context);
}
