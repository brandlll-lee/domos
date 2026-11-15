import type { EngineRun } from "@domos/agent/harness/types";
import type { ChatMessage } from "@domos/agent/messages";
import type { ChatView } from "@domos/agent/view";

export type WorkActivity = {
  id: string;
  label: string;
  working: boolean;
  attention?: boolean;
  botId?: number;
  author?: ChatMessage["author"];
};

const toolLabels: Record<string, string> = {
  websearch: "正在搜索网页",
  web_search: "正在搜索网页",
  search_web: "正在搜索网页",
  webfetch: "正在读取网页",
  web_fetch: "正在读取网页",
  read_page: "正在读取网页",
  read: "正在读取文件",
  read_file: "正在读取文件",
  readfile: "正在读取文件",
  bash: "正在运行命令",
  shell: "正在运行命令",
  exec_command: "正在运行命令",
  commandexecution: "正在运行命令",
  write: "正在写入文件",
  write_file: "正在写入文件",
  edit: "正在修改文件",
  apply_patch: "正在修改文件",
  filechange: "正在修改文件",
};

export function executionActivity(
  view: ChatView,
  run: Pick<
    EngineRun,
    "turnId" | "status" | "sessionId" | "inputTurns" | "author"
  >,
  messages = view.messages,
): WorkActivity {
  const activity = view.activity?.find(
    (item) =>
      item.executionId === run.turnId &&
      (run.sessionId === undefined || item.sessionId === run.sessionId),
  );
  const rows = [...messages, ...(view.draft ? [view.draft] : [])].filter(
    (message) =>
      (message.turnId === run.turnId ||
        run.inputTurns?.includes(message.turnId ?? message.id)) &&
      (run.sessionId === undefined ||
        (message.sessionId ?? view.id) === run.sessionId),
  );
  const result: WorkActivity = {
    id: run.turnId,
    label: "正在工作",
    working: true,
    botId: activity?.botId ?? run.author?.botId,
    author:
      activity?.author ??
      run.author ??
      rows.find((message) => message.author)?.author,
  };
  const waiting = (label: string, attention = true) => ({
    ...result,
    label,
    working: false,
    attention,
  });
  if (run.status === "stopping") return waiting("正在停止");
  if (activity?.waiting) {
    const text = activity.waiting;
    if (text.includes("接管")) return waiting("等你完成接管");
    if (text.includes("回答")) return waiting("等你回答");
    if (text.includes("确认")) return waiting("等你确认");
    return waiting("等待执行", false);
  }
  const approval = rows.find(
    (message) =>
      message.approval?.state === "pending" ||
      message.takeover?.state === "waiting" ||
      message.takeover?.state === "controlling",
  );
  const request = approval?.approval?.request;
  if (approval)
    return waiting(
      approval.takeover || request?.takeover
        ? "等你完成接管"
        : request?.kind === "question"
          ? "等你回答"
          : "等你确认",
    );
  if (run.sessionId === undefined || run.sessionId === view.id) {
    const request = !activity?.author ? view.approvals?.[0] : undefined;
    if (request)
      return waiting(
        request.takeover
          ? "等你完成接管"
          : request.kind === "question"
            ? "等你回答"
            : "等你确认",
      );
    if (view.runtime?.compaction === "running")
      return { ...result, label: "正在整理上下文" };
    if (view.runtime?.retry) return waiting("正在等待引擎响应", false);
  }
  if (activity?.retry) return waiting("正在等待引擎响应", false);
  const results = new Map(
    rows
      .filter((message) => message.toolCallId)
      .map((message) => [message.toolCallId, message]),
  );
  for (let index = rows.length - 1; index >= 0; index--) {
    const message = rows[index];
    if (message?.role !== "assistant" || message.stopped) continue;
    for (const part of message.content.toReversed()) {
      if (part.type === "toolCall") {
        const response = results.get(part.id);
        if (
          response &&
          response.toolStatus !== "running" &&
          response.toolStatus !== "pending"
        )
          continue;
        const name = part.name.split("__").at(-1)?.toLowerCase() ?? "";
        return { ...result, label: toolLabels[name] ?? "正在使用工具" };
      }
      if (message.pending && !message.endedAt) {
        if (part.type === "text") return { ...result, label: "正在回复" };
        if (part.type === "thinking") return { ...result, label: "正在思考" };
      }
    }
  }
  return result;
}

export function chatActivity(
  view: ChatView | null | undefined,
): WorkActivity[] {
  if (!view?.busy) return [];
  const runs = (view.runs ?? []).filter(
    (run) => run.status === "running" || run.status === "stopping",
  );
  const active = new Map<
    string,
    Pick<EngineRun, "turnId" | "status" | "sessionId" | "inputTurns" | "author">
  >(runs.map((run) => [run.turnId, run]));
  for (const item of view.activity ?? []) {
    if (!item.executionId || (!item.processing && !item.waiting)) continue;
    if (!active.has(item.executionId))
      active.set(item.executionId, {
        turnId: item.executionId,
        sessionId: item.sessionId,
        status: "running",
      });
  }
  if (
    !active.size &&
    view.activeTurnId &&
    !view.runs?.some((run) => run.turnId === view.activeTurnId)
  )
    return [
      executionActivity(view, { turnId: view.activeTurnId, status: "running" }),
    ];
  return [...active.values()].map((run) => executionActivity(view, run));
}
