import { chatView } from "@domos/agent/view";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import {
  type Conversation,
  ConversationBusy,
} from "@earendil-works/pi-durable";
import { ORPCError, os } from "@orpc/server";
import { z } from "zod";

export function createRouter(conversation: Conversation) {
  return {
    get: os.handler(async () => {
      const view = await conversation.viewState(BACKGROUND_CONTEXT);
      try {
        return chatView(view.value);
      } finally {
        view.dispose();
      }
    }),
    send: os
      .input(z.object({ text: z.string().trim().min(1), requestId: z.uuid() }))
      .handler(async ({ input }) => {
        try {
          const submission = await conversation.submit(
            {
              type: "input",
              content: input.text,
              requestId: input.requestId,
              whenBusy: "reject",
            },
            BACKGROUND_CONTEXT,
          );
          return { id: submission.id };
        } catch (error) {
          if (error instanceof ConversationBusy)
            throw new ORPCError("CONFLICT");
          throw error;
        }
      }),
    stop: os.handler(async () => {
      await conversation.abort(BACKGROUND_CONTEXT);
      return { ok: true };
    }),
    subscribe: os.handler(async function* ({ signal }) {
      const context = signal
        ? withAbortSignal(signal, BACKGROUND_CONTEXT)
        : BACKGROUND_CONTEXT;
      const watch = await conversation.watch(context);
      let pending: typeof watch.value | undefined = watch.value;
      let changed = Promise.withResolvers<void>();
      let closed = false;
      watch.start(async (value) => {
        pending = value;
        changed.resolve();
      });
      void watch.closed.then(() => {
        closed = true;
        changed.resolve();
      });
      try {
        while (!closed && !signal?.aborted) {
          if (pending) {
            const value = pending;
            pending = undefined;
            yield chatView(value);
          } else {
            await changed.promise;
            changed = Promise.withResolvers<void>();
          }
        }
        if (!signal?.aborted) throw new ORPCError("SERVICE_UNAVAILABLE");
      } finally {
        await watch.stop();
      }
    }),
  };
}

export type AppRouter = ReturnType<typeof createRouter>;
