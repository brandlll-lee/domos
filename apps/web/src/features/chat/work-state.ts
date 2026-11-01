import type { ChatMessage } from "@domos/agent/messages";
import type { ChatView } from "@domos/agent/view";

export type WorkItem = {
  id: string;
  label: string;
  kind: "toolCall" | "thinking" | "text" | "event";
  detail: string | ChatMessage["content"];
  result?: ChatMessage;
  message: ChatMessage;
  input?: Record<string, unknown>;
  startedAt?: number;
  endedAt?: number;
  status: string;
};
export function workTurns(view: ChatView) {
  const groups = new Map<string, ChatMessage[]>();
  for (const message of [
    ...view.messages,
    ...(view.draft ? [view.draft] : []),
  ]) {
    if (message.approval || message.takeover) continue;
    const original = message.turnId ?? message.id;
    const id =
      view.runs?.find((run) => run.inputTurns?.includes(original))?.turnId ??
      original;
    const rows = groups.get(id) ?? [];
    rows.push(message);
    groups.set(id, rows);
  }
  return [...groups]
    .map(([id, messages]) => {
      const run = view.runs?.findLast((item) => item.turnId === id);
      const active = id === view.activeTurnId;
      const status =
        run?.status ??
        (active
          ? "running"
          : messages.some((m) => m.stopped)
            ? "stopped"
            : "recorded");
      const results = new Map(
        messages.filter((m) => m.toolCallId).map((m) => [m.toolCallId, m]),
      );
      const items = messages.flatMap((message): WorkItem[] => {
        if (message.role === "user" || message.role === "toolResult") return [];
        const event = message.activity;
        const rows = message.content.flatMap((part): WorkItem[] => {
          if (part.type === "image") return [];
          const tool = part.type === "toolCall" ? part : null;
          const result = tool ? results.get(tool.id) : undefined;
          const text =
            part.type === "text"
              ? part.text
              : part.type === "thinking"
                ? part.thinking
                : tool?.name;
          if (!text?.trim()) return [];
          return [
            {
              id: part.key,
              detail: tool
                ? ""
                : part.type === "thinking"
                  ? part.thinking
                  : [part],
              result,
              message,
              input: tool?.arguments,
              kind: part.type,
              label:
                tool?.name ?? (part.type === "thinking" ? "原生思考" : "回复"),
              startedAt: message.receivedAt ?? message.timestamp,
              endedAt: tool
                ? (result?.endedAt ?? result?.timestamp)
                : message.endedAt,
              status: result
                ? result.toolStatus === "running" && !active
                  ? status === "stopped"
                    ? "stopped"
                    : "uncertain"
                  : (result.toolStatus ?? (result.isError ? "failed" : "done"))
                : active && (tool || message.pending)
                  ? "running"
                  : tool
                    ? "uncertain"
                    : "recorded",
            },
          ];
        });
        if (event || message.error) {
          let label = message.error ? "执行错误" : "引擎通知";
          if (event?.type === "plan") label = "原生计划";
          if (event?.type === "compaction")
            label = `上下文压缩 · ${event.status}`;
          if (event?.type === "approval") label = event.approval.title;
          if (event?.type === "approval_closed") label = "审批已结束";
          if (event?.type === "runtime")
            label =
              Object.values(event.state.notices ?? {}).join(" · ") ||
              event.state.retry ||
              label;
          rows.push({
            id: message.id,
            detail: message.error ?? "",
            message,
            kind: "event",
            label,
            startedAt: message.timestamp,
            status: message.error ? "failed" : "recorded",
          });
        }
        return rows;
      });
      const running = items.filter((item) => item.status === "running");
      let title = workStatus(status);
      if (active) {
        title = running.at(-1)?.label ?? "正在等待原生引擎";
        if (running.length > 1) title += ` · ${running.length} 项进行中`;
        if (view.runtime?.compaction === "running") title = "正在压缩上下文";
        if (view.approvals?.length) title = "正在等待你的确认";
        if (status === "stopping") title = "正在停止，等待引擎确认";
      }
      return {
        id,
        run,
        active,
        status,
        title,
        items,
        request: messages
          .filter((m) => m.role === "user")
          .flatMap((m) =>
            m.content.filter((p) => p.type === "text").map((p) => p.text),
          )
          .join("\n"),
        startedAt: run?.startedAt ?? messages[0]?.timestamp,
        endedAt: run?.endedAt,
      };
    })
    .toReversed();
}
const labels: Record<string, string> = {
  running: "进行中",
  stopping: "正在停止",
  ended: "执行已结束",
  stopped: "已停止",
  failed: "执行失败",
  uncertain: "结果待核对",
  recorded: "历史记录",
  done: "已返回",
};
export function workStatus(status: string) {
  return labels[status] ?? status;
}
export function workTime(start?: number, end?: number) {
  if (start === undefined || end === undefined) return "—";
  const seconds = Math.max(0, (end - start) / 1000);
  return seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
