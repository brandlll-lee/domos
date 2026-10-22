import type { EngineId, EngineRuntimeState } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { ScrollArea } from "@domos/ui/scroll-area";
import { Toast } from "@domos/ui/toast";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useRef } from "react";
import { EngineMark } from "../bots/engine-mark.tsx";
import "./runtime.css";

type RuntimeNotificationProps = {
  state?: EngineRuntimeState;
  provider: EngineId;
  name: string;
  onOpen: () => void;
};

export function RuntimeNotifications(props: RuntimeNotificationProps) {
  return (
    <Toast.Provider timeout={6000}>
      <RuntimeNotificationList {...props} />
    </Toast.Provider>
  );
}

function RuntimeNotificationList({
  state,
  provider,
  name,
  onOpen,
}: RuntimeNotificationProps) {
  const { toasts, add } = Toast.useToastManager<{ provider: EngineId }>();
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const notices = new Map<string, string>();
    for (const [id, text] of Object.entries(state?.notices ?? {}))
      if (text && !notices.has(text)) notices.set(text, id);
    for (const [text, id] of notices) {
      const key = `${id}:${text}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      add({ id: key, title: name, description: text, data: { provider } });
    }
  }, [state?.notices, name, provider, add]);
  if (!toasts.length) return null;
  return (
    <Toast.Portal>
      <Toast.Viewport
        className="runtime-notifications"
        role="region"
        aria-label="引擎通知"
      >
        {toasts.map((toast) => (
          <Toast.Root
            className="runtime-notification"
            key={toast.id}
            toast={toast}
          >
            <EngineMark provider={toast.data?.provider ?? provider} />
            <div className="runtime-notification-content">
              <Toast.Title render={<strong />} />
              <ScrollArea className="runtime-notification-scroll">
                <Toast.Description render={<p />} />
              </ScrollArea>
            </div>
            <div className="runtime-notification-actions">
              <Toast.Close
                render={<Button variant="ghost" size="icon-small" />}
                aria-label="关闭通知"
              >
                <XIcon />
              </Toast.Close>
              <Button variant="secondary" size="small" onClick={onOpen}>
                查看
              </Button>
            </div>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export function RuntimeStatus({
  state,
  onDraft,
}: {
  state?: EngineRuntimeState;
  onDraft: (text: string) => void;
}) {
  if (!state) return null;
  const status =
    state.compaction === "running"
      ? "正在压缩…"
      : state.compaction === "completed"
        ? "压缩完成"
        : state.compaction === "uncertain"
          ? "压缩结果未确认"
          : "压缩失败";
  return (
    <section
      className="runtime-status detail-stack"
      aria-label="上下文状态"
      aria-live="polite"
    >
      {state.compaction && <span className="activity-caption">{status}</span>}
      {state.editorText !== undefined && (
        <Button
          size="small"
          variant="secondary"
          onClick={() => onDraft(state.editorText ?? "")}
        >
          使用扩展草稿
        </Button>
      )}
    </section>
  );
}
