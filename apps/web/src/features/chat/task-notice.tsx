import type { TaskNotice as Notice } from "@domos/agent/transcript";
import { chatCopy } from "./copy.ts";

export function TaskNotice({ notice }: { notice: Notice }) {
  return (
    <div className="task-notice" data-state={notice.status}>
      <p role="alert">{notice.error ?? chatCopy.taskFailed}</p>
    </div>
  );
}
