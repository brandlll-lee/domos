import type {
  Activity,
  ActivityStep,
  ToolStatus,
} from "@domos/agent/transcript";
import { ActivityDisclosure } from "@domos/ui/activity";
import { MessageMarkdown } from "@domos/ui/markdown";
import { chatCopy } from "./copy.ts";
import { MessageContent } from "./message-content.tsx";

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
    <ActivityDisclosure
      label={`${step.name} · ${toolStatus(step.status)}`}
      active={step.status === "running" || step.status === "pending"}
      attention={step.status === "failed"}
    >
      <div className="activity-detail">
        <span className="activity-caption">{chatCopy.toolInput}</span>
        <pre>{JSON.stringify(step.arguments, null, 2)}</pre>
        <span className="activity-caption">{chatCopy.toolOutput}</span>
        {step.output.length ? (
          <MessageContent content={step.output} />
        ) : (
          <pre>{step.liveOutput ?? chatCopy.toolWaiting}</pre>
        )}
      </div>
    </ActivityDisclosure>
  );
}

export function ExecutionActivity({ activity }: { activity: Activity }) {
  const tools = activity.steps.filter((step) => step.type === "tool");
  const failures = tools.filter((step) => step.status === "failed").length;
  const current =
    tools.find((step) => step.status === "running") ??
    tools.find((step) => step.status === "pending");
  const active = activity.status === "running";
  const label = active
    ? current
      ? `${toolStatus(current.status)} · ${current.name}`
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
  return (
    <section
      className="execution-activity"
      aria-label={chatCopy.activity}
      data-state={activity.status}
    >
      <ActivityDisclosure
        label={label}
        active={active}
        attention={activity.status === "failed"}
        notice={failures ? chatCopy.activityFailures(failures) : undefined}
      >
        {activity.steps.length ? (
          activity.steps.map((step) => <Step key={step.id} step={step} />)
        ) : (
          <p className="activity-caption">{chatCopy.thinkingActive}</p>
        )}
      </ActivityDisclosure>
    </section>
  );
}
