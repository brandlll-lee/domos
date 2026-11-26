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
  grep: "正在搜索文件内容",
  glob: "正在查找文件",
  list_files: "正在查看文件目录",
  memory_list: "正在查看记忆",
  memory_search: "正在查找相关记忆",
  memory_save: "正在保存记忆",
  memory_delete: "正在删除记忆",
  conversation_read: "正在查阅聊天记录",
  attach_file: "正在交付文件",
  send_link_card: "正在发送链接",
  image_generate: "正在生成图片",
  character_list: "正在查看角色",
  bot_update: "正在更新角色",
  routine_list: "正在查看例行任务",
  routine_create: "正在申请创建例行任务",
  routine_manage: "正在申请修改例行任务",
  routine_report: "正在提交例行任务结果",
  bot_list: "正在查看伙伴",
  bot_send: "正在向伙伴发送任务",
  bot_status: "正在查看协作进度",
  bot_cancel: "正在取消协作任务",
  skill_read: "正在读取技能",
  skill_save: "正在保存技能",
  ask_question: "正在提交问题",
  review_draft: "正在提交草稿",
  request_credentials: "正在请求配置应用连接",
  approve: "正在请求操作确认",
  computer_request_takeover: "正在请求你接管",
  computer_assist: "正在操作电脑",
  query_result: "正在读取工具结果",
  tool_search: "正在查找可用工具",
  mcp_call: "正在调用应用工具",
  mcptoolcall: "正在调用应用工具",
};

const browserLabels: Record<string, string> = {
  open: "正在打开网页",
  navigate: "正在打开网页",
  goto: "正在打开网页",
  click: "正在点击页面",
  dblclick: "正在双击页面",
  fill: "正在填写表单",
  type: "正在输入内容",
  press: "正在按键",
  check: "正在选择选项",
  uncheck: "正在取消选项",
  select: "正在选择选项",
  hover: "正在查看页面元素",
  drag: "正在拖动页面元素",
  scroll: "正在滚动页面",
  upload: "正在上传文件",
  download: "正在下载文件",
  screenshot: "正在查看页面截图",
  snapshot: "正在读取页面结构",
  observe: "正在观察页面",
  eval: "正在运行页面脚本",
  batch: "正在执行浏览器操作",
  wait: "正在等待页面条件",
  restart: "正在准备浏览器",
  back: "正在返回上一页",
  forward: "正在前往下一页",
  reload: "正在刷新页面",
  tab_new: "正在打开标签页",
  tab_list: "正在查看标签页",
  tab_switch: "正在切换标签页",
  tab_close: "正在关闭标签页",
  close: "正在关闭浏览器",
};
const desktopLabels: Record<string, string> = {
  run_steps: "正在执行电脑操作",
  zoom: "正在查看屏幕细节",
  get_screen_size: "正在读取屏幕信息",
  get_agent_cursor_state: "正在读取光标状态",
  parse_visual_regions: "正在读取屏幕区域",
  list_windows: "正在查看电脑窗口",
  list_apps: "正在查看电脑应用",
  get_window_state: "正在读取窗口状态",
  get_desktop_state: "正在查看桌面",
  screenshot: "正在查看屏幕",
  capture_screen: "正在查看屏幕",
  click: "正在点击电脑界面",
  double_click: "正在双击电脑界面",
  set_value: "正在填写电脑界面",
  type_text: "正在输入内容",
  press_key: "正在按键",
  scroll: "正在滚动电脑界面",
  drag: "正在拖动电脑界面",
  launch_app: "正在打开应用",
  bring_to_front: "正在切换应用窗口",
  verify_state: "正在核对界面状态",
  batch: "正在执行电脑操作",
  execute_script: "正在运行电脑脚本",
};

function text(input: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys)
    if (typeof input[key] === "string" && input[key])
      return input[key] as string;
  return undefined;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function fileLabel(
  verb: string,
  fallback: string,
  input: Record<string, unknown>,
) {
  const path = text(input, "path", "file_path", "filePath", "filename");
  const name = path
    ?.replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.replace(/\p{Cc}/gu, "")
    .slice(0, 48);
  return name ? `${verb}「${name}」` : fallback;
}
function pageLabel(input: Record<string, unknown>) {
  const address = text(input, "url");
  if (!address) return "正在打开网页";
  try {
    const url = new URL(address);
    if (["http:", "https:"].includes(url.protocol))
      return `正在打开 ${url.hostname}`;
  } catch {}
  return "正在打开网页";
}

export function toolActivityLabel(
  original: string,
  originalInput: Record<string, unknown>,
): string {
  let name = original;
  let input = originalInput;
  if (name.toLowerCase() === "mcptoolcall") {
    const tool = text(input, "tool");
    if (tool && text(input, "server") === "domos") {
      name = tool;
      input = record(input.arguments);
    }
  }
  const nativeMcp = /^mcp__([^_]+)__(.+)$/.exec(name);
  if (nativeMcp) {
    if (nativeMcp[1] === "domos") name = nativeMcp[2] ?? name;
    else return "正在调用应用工具";
  }
  name = name.toLowerCase();
  if (
    name.startsWith("browser_agent_browser_") ||
    name.startsWith("agent_browser_")
  ) {
    const action = name.replace(/^(?:browser_)?agent_browser_/, "");
    if (["open", "navigate", "goto"].includes(action)) return pageLabel(input);
    if (action.startsWith("get_")) return "正在读取页面信息";
    if (action.startsWith("is_") || action.startsWith("dialog_"))
      return "正在核对页面状态";
    return browserLabels[action] ?? "正在操作浏览器";
  }
  const desktopLabel = desktopLabels[name];
  if (desktopLabel) return desktopLabel;
  if (name.startsWith("desktop_"))
    return desktopLabels[name.slice(8)] ?? "正在操作电脑";
  if (["read", "read_file", "readfile"].includes(name))
    return fileLabel("正在读取", "正在读取文件", input);
  if (["write", "write_file"].includes(name))
    return fileLabel("正在写入", "正在写入文件", input);
  if (["edit", "apply_patch", "filechange"].includes(name))
    return fileLabel("正在修改", "正在修改文件", input);
  if (
    name === "memory_save" &&
    typeof input.revision === "number" &&
    input.revision > 0
  )
    return "正在更新记忆";
  if (name === "image_generate" && input.recoverRequestId)
    return "正在恢复图片结果";
  if (name === "image_generate" && input.purpose === "avatar")
    return "正在生成角色头像";
  if (name === "request_credentials" && !input.connectionId)
    return "正在查看应用连接";
  if (
    name === "bot_update" &&
    input.name &&
    !input.avatar &&
    !input.resetAvatar
  )
    return "正在更新伙伴名称";
  if (name === "routine_manage") {
    const actions: Record<string, string> = {
      update: "修改",
      pause: "暂停",
      resume: "恢复",
      run_now: "运行",
      delete: "删除",
    };
    return `正在申请${actions[text(input, "action") ?? ""] ?? "修改"}例行任务`;
  }
  if (name === "mcp_call" && input.method === "tools/list")
    return "正在读取应用工具目录";
  return toolLabels[name] ?? "正在使用工具";
}

function approvalLabel(request: NonNullable<ChatView["approvals"]>[number]) {
  if (request.takeover) return "等你完成接管";
  if (request.credential) return "等你配置应用连接";
  if (request.draft) return "等你审阅草稿";
  return request.kind === "question" ? "等你回答" : "等你确认";
}

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
  const approval = rows.find(
    (message) =>
      message.approval?.state === "pending" ||
      message.takeover?.state === "waiting" ||
      message.takeover?.state === "controlling",
  );
  if (approval?.takeover) return waiting("等你完成接管");
  if (approval?.approval)
    return waiting(approvalLabel(approval.approval.request));
  if (
    (run.sessionId === undefined || run.sessionId === view.id) &&
    !activity?.author
  ) {
    const request = view.approvals?.[0];
    if (request) return waiting(approvalLabel(request));
  }
  if (activity?.waiting) {
    const text = activity.waiting;
    if (text.includes("接管")) return waiting("等你完成接管");
    if (text.includes("回答")) return waiting("等你回答");
    if (text.includes("确认")) return waiting("等你确认");
    return waiting("等待执行", false);
  }
  if (run.sessionId === undefined || run.sessionId === view.id) {
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
  const calls = new Map<
    string,
    { name: string; arguments: Record<string, unknown> }
  >();
  for (const message of rows) {
    if (message.stopped) continue;
    for (const part of message.content)
      if (part.type === "toolCall") {
        const result = results.get(part.id);
        if (
          !result ||
          result.toolStatus === "running" ||
          result.toolStatus === "pending"
        )
          calls.set(part.id, part);
      }
  }
  if (calls.size > 1)
    return { ...result, label: `正在处理 ${calls.size} 项操作` };
  const call = calls.values().next().value;
  if (call)
    return { ...result, label: toolActivityLabel(call.name, call.arguments) };
  for (let index = rows.length - 1; index >= 0; index--) {
    const message = rows[index];
    if (message?.role !== "assistant" || message.stopped) continue;
    for (const part of message.content.toReversed()) {
      if (part.type === "toolCall") {
        continue;
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
    if (
      view.runs?.some(
        (run) =>
          run.turnId === item.executionId &&
          run.status !== "running" &&
          run.status !== "stopping",
      )
    )
      continue;
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
