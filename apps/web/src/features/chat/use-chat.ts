import type { Attachment } from "@domos/agent/attachments";
import type { InputMaterials, MaterialSelection } from "@domos/agent/materials";
import type { TranscriptItem } from "@domos/agent/transcript";
import type { ChatView } from "@domos/agent/view";
import { ORPCError } from "@orpc/client";
import { useEffect, useMemo, useState } from "react";
import { client } from "../../client.ts";
import { chatCopy } from "./copy.ts";
import { rejectionMessage } from "./request-error.ts";
import { transcriptState } from "./transcript-state.ts";

export type SendInput = MaterialSelection & {
  text: string;
  requestId: string;
  attachments?: string[];
};

export function useChat(botId: number, onModelRequired?: () => void) {
  const [view, setView] = useState<ChatView | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [sentRequest, setSentRequest] = useState<string>();
  const [outgoing, setOutgoing] = useState<TranscriptItem[]>([]);
  const [project] = useState(transcriptState);
  const { items } = useMemo(
    () => (view ? project(view, outgoing) : { items: outgoing }),
    [view, outgoing, project],
  );

  useEffect(() => {
    const controller = new AbortController();
    let pending: ChatView | undefined;
    let frame: number | undefined;
    const flush = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      if (!pending || controller.signal.aborted) return;
      const next = pending;
      pending = undefined;
      setView(next);
      setConnected(true);
    };
    const visible = () => {
      if (!document.hidden) flush();
    };
    document.addEventListener("visibilitychange", visible);
    void (async () => {
      try {
        const events = await client.subscribe(
          { botId },
          {
            signal: controller.signal,
            context: {
              retry: Number.POSITIVE_INFINITY,
              onRetry: () => {
                if (!controller.signal.aborted) setConnected(false);
              },
            },
          },
        );
        for await (const next of events) {
          if (controller.signal.aborted) return;
          pending = next;
          if (document.hidden) {
            if (!next.busy || next.approvals?.length) flush();
          } else if (frame === undefined) frame = requestAnimationFrame(flush);
        }
      } catch {
        if (!controller.signal.aborted) setError(chatCopy.errors.connect);
      } finally {
        if (!controller.signal.aborted) {
          flush();
          setConnected(false);
        }
      }
    })();
    return () => {
      controller.abort();
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [botId]);

  async function send(
    input: SendInput,
    attachments?: Attachment[],
    materials?: InputMaterials,
  ) {
    setSentRequest(input.requestId);
    setSending(true);
    setError(null);
    setOutgoing((current) => [
      ...current.filter(
        (item) =>
          item.id !== input.requestId &&
          !view?.messages.some((message) => message.requestId === item.id),
      ),
      {
        kind: "message",
        id: input.requestId,
        message: {
          id: input.requestId,
          requestId: input.requestId,
          role: "user",
          content: [{ type: "text", text: input.text, key: input.requestId }],
          stopped: false,
          timestamp: Date.now(),
          attachments,
          materials,
        },
      },
    ]);
    try {
      await client.send({ ...input, botId });
      return "accepted" as const;
    } catch (cause) {
      if (cause instanceof ORPCError && cause.code === "PRECONDITION_FAILED")
        onModelRequired?.();
      const message = rejectionMessage(cause);
      if (message)
        setOutgoing((current) =>
          current.filter((item) => item.id !== input.requestId),
        );
      setError(message ?? chatCopy.errors.unconfirmed);
      return message ? ("rejected" as const) : ("unconfirmed" as const);
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    setStopping(true);
    setError(null);
    try {
      await client.stop({ botId });
    } catch {
      setError(chatCopy.errors.stop);
    } finally {
      setStopping(false);
    }
  }

  return {
    view,
    items,
    sentRequest,
    connected,
    error,
    sending,
    stopping,
    send,
    stop,
  };
}
