import type { ChatMessage } from "@domos/agent/messages";
import type { ChatView } from "@domos/agent/view";
import { executionActivity } from "./activity-state.ts";
import type { TimelineRun, TimelineState } from "./work-timeline.tsx";

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
  for (const item of view.activity ?? [])
    if (item.waiting && item.executionId && !groups.has(item.executionId))
      groups.set(item.executionId, []);
  return [...groups]
    .map(([id, messages]) => {
      const run = view.runs?.findLast((item) => item.turnId === id);
      const activity = view.activity?.find((item) => item.executionId === id);
      const active = activity?.waiting
        ? true
        : run
          ? run.status === "running" || run.status === "stopping"
          : id === view.activeTurnId;
      const status =
        run?.status ??
        (activity?.waiting && !activity.processing
          ? "queued"
          : active
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
      const issue = !active
        ? status === "failed" || items.some((item) => item.status === "failed")
          ? "failed"
          : status === "uncertain" ||
              items.some((item) => item.status === "uncertain")
            ? "uncertain"
            : undefined
        : undefined;
      let title = workStatus(status);
      let working = false;
      if (!active && run?.evidence?.usage === "failed")
        title += " · 用量入账失败";
      if (issue === "uncertain" && issue !== status) title += " · 结果待核对";
      if (active) {
        const progress = executionActivity(
          view,
          {
            turnId: id,
            sessionId: run?.sessionId ?? activity?.sessionId,
            inputTurns: run?.inputTurns,
            status: status === "stopping" ? "stopping" : "running",
          },
          messages,
        );
        title = progress.label;
        working = progress.working;
      }
      const request = messages
        .filter((m) => m.role === "user")
        .flatMap((m) =>
          m.content.filter((p) => p.type === "text").map((p) => p.text),
        )
        .join("\n");
      return {
        id,
        run,
        author:
          run?.author ??
          messages.find((message) => message.author)?.author ??
          activity?.author,
        sessionId:
          run?.sessionId ??
          activity?.sessionId ??
          messages.find((message) => message.sessionId)?.sessionId,
        active,
        status,
        title,
        working,
        issue,
        toolFailures: items.filter(
          (item) => item.kind === "toolCall" && item.status === "failed",
        ).length,
        items,
        request,
        subject:
          messages.find((message) => message.routine)?.routine?.title ??
          request
            .split(/\r?\n/)
            .find((line) => line.trim())
            ?.trim() ??
          messages.find(
            (message) => message.role === "user" && message.attachments?.length,
          )?.attachments?.[0]?.name ??
          "工作记录",
        startedAt: run?.startedAt ?? messages[0]?.timestamp,
        endedAt: run?.endedAt,
      };
    })
    .toReversed();
}

export function workGroups<T extends { startedAt?: number }>(
  turns: T[],
  now: number,
) {
  const history = turns.toSorted(
    (a, b) => (b.startedAt ?? -Infinity) - (a.startedAt ?? -Infinity),
  );
  const groups = new Map<string, typeof turns>();
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const dates = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  for (const turn of history) {
    const date =
      turn.startedAt === undefined ? undefined : new Date(turn.startedAt);
    const label = !date
      ? "时间未提供"
      : date.toDateString() === today.toDateString()
        ? "今天"
        : date.toDateString() === yesterday.toDateString()
          ? "昨天"
          : dates.format(date);
    const rows = groups.get(label) ?? [];
    rows.push(turn);
    groups.set(label, rows);
  }
  return [...groups].map(([label, turns]) => ({ label, turns }));
}
const labels: Record<string, string> = {
  running: "进行中",
  stopping: "正在停止",
  ended: "执行已结束",
  stopped: "已停止",
  failed: "执行失败",
  uncertain: "结果待核对",
  recorded: "历史记录",
  queued: "等待执行",
  done: "已返回",
};
export function workStatus(status: string) {
  return labels[status] ?? status;
}
export function workTime(start?: number, end?: number) {
  if (start === undefined || end === undefined) return "—";
  const seconds = Math.max(0, (end - start) / 1000);
  return seconds < 60
    ? `${Number(seconds.toFixed(1))}秒`
    : `${Math.floor(seconds / 60)}分${String(Math.floor(seconds % 60)).padStart(2, "0")}秒`;
}

export function timelineState(status: string): TimelineState {
  switch (status) {
    case "running":
    case "queued":
    case "stopping":
    case "ended":
    case "stopped":
    case "failed":
    case "uncertain":
    case "done":
      return status;
    default:
      return "recorded";
  }
}
export function workTimeline(
  turn: ReturnType<typeof workTurns>[number],
  now: number,
): TimelineRun {
  return {
    id: turn.id,
    title: turn.subject,
    startedAt: turn.startedAt,
    state:
      turn.active && !turn.working && turn.status === "running"
        ? "waiting"
        : timelineState(turn.status),
    label: turn.title,
    duration: workTime(
      turn.startedAt,
      turn.endedAt ?? (turn.active ? now : undefined),
    ).replace("—", "耗时未知"),
    harness: turn.run?.provider,
    model: turn.run?.model ?? undefined,
    toolFailures: turn.toolFailures,
  };
}
