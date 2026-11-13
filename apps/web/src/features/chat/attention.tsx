import type { ChatAttention, ChatTarget } from "@domos/agent/chat-directory";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Toast } from "@domos/ui/toast";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { client, computerScope } from "../../client.ts";
import "./attention.css";

const schema = z.object({
  read: z.record(z.string(), z.number().int().nonnegative()).default({}),
  muted: z.record(z.string(), z.boolean()).default({}),
  silent: z.boolean().default(false),
  event: z.number().int().nonnegative().optional(),
  counts: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
type Preferences = z.infer<typeof schema>;
const key = () => `domos:attention:v1:${computerScope}`;
function saved() {
  try {
    return schema.parse(JSON.parse(localStorage.getItem(key()) ?? "{}"));
  } catch {
    return schema.parse({});
  }
}
let pendingTarget: ChatTarget | undefined;
export function openChatTarget(target: ChatTarget) {
  pendingTarget = target;
  window.location.hash = target.chat;
  window.dispatchEvent(new CustomEvent("domos:chat-open", { detail: target }));
}
export function consumeChatTarget(chat: string) {
  if (pendingTarget?.chat !== chat) return;
  const target = pendingTarget;
  pendingTarget = undefined;
  return target;
}
window.addEventListener("domos:chat-target", (event) =>
  openChatTarget((event as CustomEvent<ChatTarget>).detail),
);
window.addEventListener("domos:computer", () => {
  pendingTarget = undefined;
});

type AttentionState = {
  counts: Record<string, number>;
  preferences: Preferences;
  error: string;
  revision: number;
  refresh: () => void;
  mute: (chat?: string) => void;
  read: (
    chat: string,
    messages: { sessionId: number; messageId: string }[],
  ) => Promise<boolean>;
};
const AttentionContext = createContext<AttentionState | null>(null);
export function useAttention() {
  return useContext(AttentionContext);
}
export function ChatAttentionProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider limit={3} timeout={7000}>
      <Attention>{children}</Attention>
    </Toast.Provider>
  );
}
function Attention({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(saved);
  const current = useRef(preferences);
  const [counts, setCounts] = useState(preferences.counts);
  const [hydrated, setHydrated] = useState(false);
  const [computer, setComputer] = useState("");
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0);
  const toast = Toast.useToastManager<ChatAttention>();
  const manager = useRef(toast);
  manager.current = toast;
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void window.domosDesktop?.state().then((result) => {
      if (active.current)
        setComputer(
          result.value?.instances.find(
            (item) => item.id === result.value?.selected,
          )?.name ?? "",
        );
    });
    return () => {
      active.current = false;
    };
  }, []);
  function save(next: Preferences) {
    current.current = next;
    setPreferences(next);
    try {
      localStorage.setItem(key(), JSON.stringify(next));
    } catch {
      setError("提醒设置未能保存，请检查可用存储空间。");
    }
  }
  const persist = useRef(save);
  persist.current = save;
  const readSignature = JSON.stringify({ read: preferences.read, revision });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const events = await client.chats.attention(
          { read: JSON.parse(readSignature).read },
          {
            signal: controller.signal,
            context: { retry: Number.POSITIVE_INFINITY },
          },
        );
        for await (const next of events) {
          if (controller.signal.aborted) return;
          setCounts(next.counts);
          setHydrated(true);
          setError("");
          const previous = current.current.event;
          const latest = Math.max(
            previous ?? 0,
            ...next.events.map((item) => item.sequence),
          );
          persist.current({
            ...current.current,
            event: latest,
            counts: next.counts,
          });
          for (const event of next.events
            .filter(
              (item) => previous !== undefined && item.sequence > previous,
            )
            .slice(-3)) {
            if (current.current.silent || current.current.muted[event.chat])
              continue;
            const node = document.querySelector<HTMLElement>(
              `[data-message-id="${CSS.escape(event.messageId)}"][data-session-id="${event.sessionId}"]`,
            );
            const bounds = node?.getBoundingClientRect();
            if (
              document.hasFocus() &&
              !document.hidden &&
              !document.querySelector('[role="dialog"][aria-modal="true"]') &&
              bounds &&
              bounds.bottom > 80 &&
              bounds.top < window.innerHeight - 100
            )
              continue;
            const result = await window.domosDesktop?.notify({
              ...event,
              title: event.name,
              body: event.text,
            });
            if (!active.current) return;
            if (result?.ok && result.value?.shown) continue;
            if (result && !result.ok)
              setError(result.error ?? "系统提醒未能发送。");
            manager.current.add({
              id: `${computerScope}:${event.sequence}`,
              title: event.name,
              description: event.text,
              data: event,
              priority: event.kind === "complete" ? "low" : "high",
            });
          }
        }
      } catch {
        if (!controller.signal.aborted) setError("提醒读取失败，请重试。");
      }
    })();
    return () => controller.abort();
  }, [readSignature]);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  useEffect(() => {
    if (!hydrated) return;
    void window.domosDesktop?.unread(total).then((result) => {
      if (result?.ok) window.dispatchEvent(new Event("domos:unread"));
    });
  }, [total, hydrated]);
  const readPending = useRef<Promise<unknown>>(Promise.resolve());
  const value: AttentionState = {
    counts,
    preferences,
    error,
    revision,
    refresh: () => refresh((value) => value + 1),
    mute(chat) {
      const previous = current.current;
      save(
        chat
          ? {
              ...previous,
              muted: { ...previous.muted, [chat]: !previous.muted[chat] },
            }
          : { ...previous, silent: !previous.silent },
      );
    },
    read(chat, messages) {
      const pending = readPending.current
        .catch(() => {})
        .then(async () => {
          if (!active.current) return false;
          try {
            const receipts = await client.chats.receipts(
              { chat, messages },
              { signal: AbortSignal.timeout(15_000) },
            );
            if (!active.current) return false;
            const read = { ...current.current.read };
            for (const [key, sequence] of Object.entries(receipts))
              read[key] = Math.max(read[key] ?? 0, sequence);
            if (JSON.stringify(read) === JSON.stringify(current.current.read))
              return true;
            persist.current({
              ...current.current,
              read,
            });
            return true;
          } catch {
            if (active.current) setError("已读位置未能保存，请重试。");
            return false;
          }
        });
      readPending.current = pending;
      return pending;
    },
  };
  return (
    <AttentionContext value={value}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="attention-viewport">
          {toast.toasts.map((item) => (
            <Toast.Root key={item.id} toast={item} className="attention-toast">
              <Button
                variant="ghost"
                className="attention-body"
                type="button"
                onClick={() => {
                  if (item.data) openChatTarget(item.data);
                  toast.close(item.id);
                }}
              >
                <BotAvatar seed={item.data?.avatar ?? "domos"} />
                <span>
                  <Toast.Title className="attention-title" />
                  <Toast.Description className="attention-description" />
                  <span className="attention-context">
                    {[item.data?.chatName, computer]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </Button>
              <Toast.Close
                render={
                  <Button
                    variant="ghost"
                    size="icon-small"
                    aria-label="关闭提醒"
                  />
                }
              >
                <XIcon />
              </Toast.Close>
            </Toast.Root>
          ))}
        </Toast.Viewport>
      </Toast.Portal>
    </AttentionContext>
  );
}
