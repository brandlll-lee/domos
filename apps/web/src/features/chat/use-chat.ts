import type { Attachment } from "@domos/agent/attachments";
import type { InputMaterials, MaterialSelection } from "@domos/agent/materials";
import type { TranscriptItem } from "@domos/agent/transcript";
import type { ChatView } from "@domos/agent/view";
import { ORPCError } from "@orpc/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { client } from "../../client.ts";
import { receiveConversationFiles } from "../files/file-state.ts";
import { flushModelSettings } from "../models/model-state.ts";
import { chatCopy } from "./copy.ts";
import { rejectionMessage } from "./request-error.ts";
import { transcriptState } from "./transcript-state.ts";

export type SendInput = MaterialSelection & {
  text: string;
  requestId: string;
  attachments?: string[];
};

type RetainedChat = {
  view: ChatView | null;
  outgoing: TranscriptItem[];
  sentRequest?: string;
  pendingRequest?: string;
  sending: boolean;
  error: string | null;
};
function createChatState() {
  let state: RetainedChat = {
    view: null,
    outgoing: [],
    sending: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  return {
    snapshot: () => state,
    observed: () => listeners.size > 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(patch: Partial<RetainedChat>) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
  };
}
const retained = new Map<string, ReturnType<typeof createChatState>>();
function chatState(botId: number, teamId?: string) {
  const key = teamId ? `team:${teamId}` : String(botId);
  let state = retained.get(key);
  if (!state) {
    state = createChatState();
    retained.set(key, state);
  }
  return state;
}
export function clearChatState(ids?: Set<number>) {
  for (const id of retained.keys())
    if (!ids || (!id.startsWith("team:") && !ids.has(Number(id))))
      retained.delete(id);
}
window.addEventListener("domos:pair", () => clearChatState());
window.addEventListener("domos:computer", () => clearChatState());
export function prefetchChat(botId: number) {
  if (retained.has(String(botId))) return;
  const store = chatState(botId);
  void client
    .get({ botId })
    .then((view) => {
      if (retained.get(String(botId)) === store && !store.snapshot().view)
        store.update({ view });
    })
    .catch(() => {
      if (
        retained.get(String(botId)) === store &&
        !store.snapshot().view &&
        !store.observed()
      )
        retained.delete(String(botId));
    });
}

export function useChat(
  botId: number,
  onModelRequired?: () => void,
  teamId?: string,
) {
  const [store] = useState(() => chatState(botId, teamId));
  const { view, outgoing, sentRequest, pendingRequest, sending, error } =
    useSyncExternalStore(store.subscribe, store.snapshot);
  const current = useRef<ChatView | null>(view);
  current.current ??= view;
  const setView = useCallback(
    (view: ChatView) => store.update({ view }),
    [store],
  );
  const setError = useCallback(
    (error: string | null) => store.update({ error }),
    [store],
  );
  const setSending = (sending: boolean) => store.update({ sending });
  const setSentRequest = (sentRequest: string) => store.update({ sentRequest });
  const setOutgoing = (update: (items: TranscriptItem[]) => TranscriptItem[]) =>
    store.update({ outgoing: update(store.snapshot().outgoing) });
  const [connected, setConnected] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<string>();
  const earlierRequest = useRef<AbortController | null>(null);
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
      const view = current.current ?? next;
      const pendingRequest = store.snapshot().pendingRequest;
      if (
        pendingRequest &&
        (view.activeTurnId || !view.busy) &&
        view.messages.some((message) => message.requestId === pendingRequest)
      )
        store.update({ view, pendingRequest: undefined });
      else setView(view);
      setConnected(true);
    };
    const visible = () => {
      if (!document.hidden) flush();
    };
    document.addEventListener("visibilitychange", visible);
    void (async () => {
      try {
        const events = teamId
          ? await client.teams.changes(
              { id: teamId },
              {
                signal: controller.signal,
                context: {
                  retry: Number.POSITIVE_INFINITY,
                  onRetry: () => {
                    if (!controller.signal.aborted) setConnected(false);
                  },
                },
              },
            )
          : await client.changes(
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
        for await (const event of events) {
          if (controller.signal.aborted) return;
          const previous = current.current;
          let next: ChatView;
          if (event.type === "snapshot") {
            const first = event.view.messages.find((message) => message.cursor);
            const [entry = 0, index = 0] =
              first?.cursor?.split(":").map(Number) ?? [];
            const earlier =
              previous?.messages.filter((message) => {
                const [oldEntry = 0, oldIndex = 0] =
                  message.cursor?.split(":").map(Number) ?? [];
                return (
                  oldEntry > 0 &&
                  (oldEntry < entry || (oldEntry === entry && oldIndex < index))
                );
              }) ?? [];
            next = {
              ...event.view,
              ...(earlier.length ? { before: previous?.before } : {}),
              messages: [...earlier, ...event.view.messages],
            };
          } else if (previous) {
            const changed = new Map(
              event.messages.map((message) => [message.id, message]),
            );
            const known = new Set(
              previous.messages.map((message) => message.id),
            );
            next = {
              ...previous,
              ...event.state,
              messages: [
                ...previous.messages
                  .filter((message) => !event.removed.includes(message.id))
                  .map((message) => changed.get(message.id) ?? message),
                ...event.messages.filter((message) => !known.has(message.id)),
              ],
            };
          } else continue;
          next.runs = [
            ...new Map(
              [...(previous?.runs ?? []), ...(next.runs ?? [])].map((run) => [
                run.turnId,
                run,
              ]),
            ).values(),
          ];
          receiveConversationFiles(botId, next.messages);
          current.current = next;
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
      if (current.current) store.update({ view: current.current });
      controller.abort();
      earlierRequest.current?.abort();
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [botId, store, setView, setError, teamId]);

  async function loadEarlier() {
    const before = current.current?.before;
    if (!before || earlierRequest.current) return;
    const controller = new AbortController();
    earlierRequest.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30_000),
    ]);
    setLoadingEarlier(true);
    setEarlierError(undefined);
    try {
      const page = teamId
        ? await client.teams.get({ id: teamId, before }, { signal })
        : await client.get({ botId, before }, { signal });
      signal.throwIfAborted();
      const view = current.current;
      if (!view || view.before !== before) return;
      const known = new Set(view.messages.map((message) => message.id));
      const next = {
        ...view,
        before: page.before,
        runs: [
          ...new Map(
            [...(page.runs ?? []), ...(view.runs ?? [])].map((run) => [
              run.turnId,
              run,
            ]),
          ).values(),
        ],
        messages: [
          ...page.messages.filter((message) => !known.has(message.id)),
          ...view.messages,
        ],
      };
      current.current = next;
      setView(next);
    } catch {
      if (!controller.signal.aborted)
        setEarlierError(
          signal.aborted
            ? "历史消息读取超时，请重试。"
            : "历史消息读取失败，请重试。",
        );
    } finally {
      if (earlierRequest.current === controller) {
        earlierRequest.current = null;
        if (!controller.signal.aborted) setLoadingEarlier(false);
      }
    }
  }

  async function send(
    input: SendInput,
    attachments?: Attachment[],
    materials?: InputMaterials,
  ) {
    setSentRequest(input.requestId);
    store.update({ pendingRequest: input.requestId });
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
      try {
        await flushModelSettings(botId);
      } catch (cause) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            cause instanceof Error ? cause.message : "模型配置保存失败。",
        });
      }
      if (teamId)
        await client.teams.send({
          id: teamId,
          ...input,
          attachments: attachments?.map((file) => file.id) ?? [],
          skills: materials?.skills ?? [],
          context: materials?.context ?? [],
          mcp: materials?.mcp ?? [],
          bots: materials?.bots ?? [],
        });
      else await client.send({ ...input, botId });
      return "accepted" as const;
    } catch (cause) {
      if (store.snapshot().pendingRequest === input.requestId)
        store.update({ pendingRequest: undefined });
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

  async function stop(sessionId?: number) {
    store.update({ pendingRequest: undefined });
    setStopping(true);
    setError(null);
    try {
      if (sessionId !== undefined) await client.stop({ botId: sessionId });
      else if (teamId) await client.teams.stop({ id: teamId });
      else await client.stop({ botId });
    } catch {
      setError(chatCopy.errors.stop);
    } finally {
      setStopping(false);
    }
  }

  return {
    async revealMessage(id: string) {
      while (
        current.current &&
        !current.current.messages.some((message) => message.id === id)
      ) {
        const before = current.current.before;
        if (!before) throw new Error("原消息不存在。");
        await loadEarlier();
        if (current.current.before === before)
          throw new Error("原消息读取失败。");
      }
    },
    view,
    items,
    sentRequest,
    connected,
    error,
    sending,
    processing:
      !stopping &&
      !view?.approvals?.length &&
      (Boolean(pendingRequest) || Boolean(view?.processing)),
    stopping:
      stopping ||
      view?.runs?.some(
        (run) => run.turnId === view.activeTurnId && run.status === "stopping",
      ) ||
      false,
    send,
    stop,
    loadEarlier,
    loadingEarlier,
    earlierError,
  };
}
