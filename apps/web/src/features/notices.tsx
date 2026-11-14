import type { ChatAttention } from "@domos/agent/chat-directory";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Toast } from "@domos/ui/toast";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { openChatTarget } from "./chat/attention.tsx";
import { receiveConnection, useConnection } from "./connection.ts";
import "./chat/attention.css";

export type Notice = {
  attention?: ChatAttention;
  action?: () => void | Promise<void>;
  label?: string;
};
type ErrorNotice = {
  id: string;
  message: string;
  action?: Notice["action"];
  label?: string;
};
export function notifyError(
  message: string,
  id = message,
  action?: Notice["action"],
  label = "重试",
) {
  window.dispatchEvent(
    new CustomEvent<ErrorNotice>("domos:error", {
      detail: { message, id, action, label },
    }),
  );
}
export function useErrorNotice(
  message: string | null | undefined,
  action?: Notice["action"],
) {
  const id = useId();
  const latest = useRef(action);
  latest.current = action;
  useEffect(() => {
    notifyError(
      message ?? "",
      id,
      latest.current ? () => latest.current?.() : undefined,
    );
    return () => notifyError("", id);
  }, [id, message]);
}
export function ApplicationNotices({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider limit={3} timeout={7000}>
      <Notices>{children}</Notices>
    </Toast.Provider>
  );
}
function Notices({ children }: { children: ReactNode }) {
  const toast = Toast.useToastManager<Notice>();
  const manager = useRef(toast);
  manager.current = toast;
  const state = useConnection();
  const [computer, setComputer] = useState("");
  const down = state.service !== undefined && state.service !== "ready";
  const unavailable = down || state.connected === false;
  const unavailableRef = useRef(unavailable);
  unavailableRef.current = unavailable;
  useEffect(() => {
    let active = true;
    let received = false;
    const changed = () => {
      received = true;
    };
    window.addEventListener("domos:service", changed);
    void window.domosDesktop
      ?.state()
      .then((result) => {
        if (!active || !result.ok) return;
        if (!received) receiveConnection({ service: result.value?.service });
        setComputer(
          result.value?.instances.find(
            (item) => item.id === result.value?.selected,
          )?.name ?? "",
        );
      })
      .catch(() => notifyError("桌面状态读取失败。"));
    const receive = (event: Event) => {
      const { id, message, action, label } = (event as CustomEvent<ErrorNotice>)
        .detail;
      if (!message) {
        manager.current.close(id);
        return;
      }
      if (unavailableRef.current) return;
      const options = {
        id,
        title: "Domos",
        description: message,
        type: "error",
        data: { action, label },
      };
      manager.current.add(options);
    };
    window.addEventListener("domos:error", receive);
    return () => {
      active = false;
      window.removeEventListener("domos:error", receive);
      window.removeEventListener("domos:service", changed);
    };
  }, []);
  useEffect(() => {
    const id = "workspace-connection";
    if (!unavailable) {
      manager.current.close(id);
      return;
    }
    const service = state.service;
    const recover = service === "failed" || service === "stopped";
    const options = {
      id,
      title: "Domos",
      type: "error",
      timeout: 0,
      description:
        service === "recovering"
          ? "本机服务已中断，正在恢复。"
          : service === "starting"
            ? "正在启动本机服务。"
            : down
              ? "本机服务已停止。聊天和草稿已保留。"
              : "与工作电脑的连接已中断。正在重新连接。",
      data: recover
        ? {
            label: "恢复服务",
            action: async () => {
              const result = await window.domosDesktop?.connection({
                action: "recover",
              });
              if (!result?.ok)
                manager.current.update(id, {
                  description: "本机服务恢复失败。请检查诊断记录后重试。",
                });
            },
          }
        : {},
    };
    manager.current.add(options);
  }, [unavailable, down, state.service]);
  return (
    <>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="attention-viewport">
          {toast.toasts.map((item) => {
            const content = (
              <>
                <BotAvatar seed={item.data?.attention?.avatar ?? "domos"} />
                <span>
                  <Toast.Title className="attention-title" />
                  <Toast.Description className="attention-description" />
                  {item.data?.attention && (
                    <span className="attention-context">
                      {[item.data.attention.chatName, computer]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  {item.data?.action && (
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        void Promise.resolve()
                          .then(item.data?.action)
                          .catch(() =>
                            manager.current.update(item.id, {
                              description: "操作未完成，请重试。",
                            }),
                          );
                      }}
                    >
                      {item.data.label}
                    </Button>
                  )}
                </span>
              </>
            );
            return (
              <Toast.Root
                key={item.id}
                toast={item}
                className="attention-toast"
                data-error={item.type === "error" || undefined}
                role={item.type === "error" ? "alert" : undefined}
              >
                {item.data?.attention ? (
                  <Button
                    variant="ghost"
                    className="attention-body"
                    onClick={() => {
                      if (item.data?.attention)
                        openChatTarget(item.data.attention);
                      toast.close(item.id);
                    }}
                  >
                    {content}
                  </Button>
                ) : (
                  <div className="attention-body">{content}</div>
                )}
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
            );
          })}
        </Toast.Viewport>
      </Toast.Portal>
    </>
  );
}
