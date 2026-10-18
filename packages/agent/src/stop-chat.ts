import type { Context } from "@earendil-works/chord/context";
import {
  type Conversation,
  LiveDoc,
  type LiveState,
} from "@earendil-works/pi-durable";
import { chatView } from "./chat-view.ts";
import { EngineMessage } from "./harness/state.ts";

export async function stopChat(conversation: Conversation, context: Context) {
  const state = await conversation.viewState(context);
  const live = state.value.docs[LiveDoc.definition.kind] as
    | LiveState
    | undefined;
  const taskId = live?.run?.taskId;
  const turnId = chatView(state.value).activeTurnId;
  state.dispose();
  await conversation.abort(context);
  if (!taskId || !turnId) return;
  const task = await conversation.commit((tx) => tx.task(taskId), context);
  if (
    task?.state.status !== "terminal" ||
    task.state.outcome.status !== "aborted"
  )
    return;
  await conversation.submit(
    {
      type: "write",
      requestId: `domos:stop:${taskId}`,
      entry: {
        kind: EngineMessage,
        data: {
          id: `stop:${taskId}`,
          turnId,
          role: "assistant",
          content: [],
          stopped: true,
          stopReason: "aborted",
        },
      },
    },
    context,
  );
}
