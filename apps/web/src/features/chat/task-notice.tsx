import type { TaskNotice as Notice } from "@domos/agent/transcript";
import { Button } from "@domos/ui/controls";
import { chatCopy } from "./copy.ts";

export function TaskNotice({
  notice,
  onRetry,
}: {
  notice: Notice;
  onRetry?: () => void;
}) {
  return (
    <div className="task-notice" data-state={notice.status}>
      <p role={notice.status === "failed" ? "alert" : "status"}>
        {notice.error ??
          (notice.status === "failed" ? chatCopy.taskFailed : chatCopy.stopped)}
      </p>
      {onRetry && (
        <Button
          type="button"
          size="small"
          variant="ghost"
          onClick={onRetry}
          title="将原任务放入输入框"
        >
          {chatCopy.retryTask}
        </Button>
      )}
    </div>
  );
}
