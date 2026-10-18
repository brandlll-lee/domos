import type { Bot } from "@domos/agent/bots";
import type {
  Activity,
  ActivityStep,
  ToolStatus,
} from "@domos/agent/transcript";
import { ActivityDetails, ActivityDisclosure } from "@domos/ui/activity";
import { BotAvatar } from "@domos/ui/avatar";
import { MessageMarkdown } from "@domos/ui/markdown";
import { WorkStatus } from "@domos/ui/work-status";
import { chatCopy } from "./copy.ts";
import { MessageContent } from "./message-content.tsx";

const toolLabels: Record<string, string> = {
  read: "读取文件",
  read_file: "读取文件",
  write: "写入文件",
  write_file: "写入文件",
  edit: "编辑文件",
  bash: "执行命令",
  shell: "执行命令",
  exec_command: "执行命令",
  web_search: "搜索资料",
  web_fetch: "读取网页",
  attach_file: "交付文件",
};

function toolLabel(step: Extract<ActivityStep, { type: "tool" }>) {
  const target = [
    step.arguments.path,
    step.arguments.file_path,
    step.arguments.command,
    step.arguments.url,
    step.arguments.query,
  ].find((value) => typeof value === "string");
  const name = toolLabels[step.name] ?? step.name;
  return typeof target === "string"
    ? `${name} · ${target.replace(/\s+/g, " ").slice(0, 160)}`
    : name;
}

function toolStatus(status: ToolStatus) {
  switch (status) {
    case "running":
      return chatCopy.toolRunning;
    case "pending":
      return chatCopy.toolPending;
    case "waiting":
      return chatCopy.toolWaiting;
    case "done":
      return chatCopy.toolReturned;
    case "failed":
      return chatCopy.toolFailed;
    case "stopped":
      return chatCopy.stopped;
  }
}

function Step({ step }: { step: ActivityStep }) {
  if (step.type !== "tool")
    return (
      <div className="activity-narration" data-kind={step.type}>
        {step.type === "thinking" && (
          <span className="activity-caption">{chatCopy.thinking}</span>
        )}
        <MessageMarkdown>{step.text}</MessageMarkdown>
      </div>
    );
  return (
    <ActivityDetails
      label={toolLabel(step)}
      status={toolStatus(step.status)}
      attention={step.status === "failed"}
    >
      <ActivityDetails label="操作详情" status="">
        <pre>{JSON.stringify(step.arguments, null, 2)}</pre>
      </ActivityDetails>
      <span className="activity-caption">{chatCopy.toolOutput}</span>
      {step.output.length ? (
        <MessageContent content={step.output} />
      ) : (
        !step.diagnostics?.length && (
          <pre>{step.liveOutput ?? chatCopy.toolWaiting}</pre>
        )
      )}
      {!!step.diagnostics?.length && (
        <pre>
          {step.diagnostics.map((diagnostic) => diagnostic.message).join("\n")}
        </pre>
      )}
    </ActivityDetails>
  );
}

export function activityLabel(activity: Activity) {
  const tools = activity.steps.filter((step) => step.type === "tool");
  const current =
    tools.find((step) => step.status === "running") ??
    tools.find((step) => step.status === "pending");
  const active = activity.status === "running";
  return active
    ? current
      ? `${toolStatus(current.status)} · ${toolLabel(current)}`
      : activity.responding
        ? chatCopy.working
        : chatCopy.thinkingActive
    : activity.status === "stopped"
      ? chatCopy.stopped
      : activity.status === "failed"
        ? chatCopy.activityFailed
        : tools.length
          ? chatCopy.activityComplete(tools.length)
          : chatCopy.thinkingComplete;
}

function Steps({ activity }: { activity: Activity }) {
  return activity.steps.map((step) => <Step key={step.id} step={step} />);
}

export function WorkingActivity({
  activity,
  bot,
}: {
  activity: Activity;
  bot: Bot;
}) {
  return (
    <section
      className="execution-activity"
      data-state="running"
      aria-label={chatCopy.activity}
    >
      <WorkStatus
        avatar={<BotAvatar seed={bot.avatar} state="running" size="small" />}
        label={`${bot.name} 正在工作`}
        summary={activityLabel(activity)}
      >
        <Steps activity={activity} />
      </WorkStatus>
    </section>
  );
}

export function ExecutionActivity({ activity }: { activity: Activity }) {
  const failures = activity.steps.filter(
    (step) => step.type === "tool" && step.status === "failed",
  ).length;
  return (
    <section
      className="execution-activity"
      aria-label={chatCopy.activity}
      data-state={activity.status}
    >
      <ActivityDisclosure
        label={activityLabel(activity)}
        attention={activity.status === "failed"}
        notice={failures ? chatCopy.activityFailures(failures) : undefined}
      >
        <Steps activity={activity} />
      </ActivityDisclosure>
    </section>
  );
}
