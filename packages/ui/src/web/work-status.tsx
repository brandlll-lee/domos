import { type ReactNode, useId, useState } from "react";
import { ActivityText } from "./activity.tsx";

export function WorkStatus({
  avatar,
  label,
  summary,
  children,
}: {
  avatar: ReactNode;
  label: string;
  summary: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <div className="work-status">
      <button
        type="button"
        className="work-trigger"
        aria-expanded={expanded}
        aria-controls={id}
        aria-label={label}
        title={summary}
        onClick={() => setExpanded(!expanded)}
      >
        <ActivityText active indicator={avatar}>
          {summary}
        </ActivityText>
        <span className="activity-chevron" aria-hidden="true" />
      </button>
      <span className="sr-only" role="status">
        {summary}
      </span>
      <div id={id} hidden={!expanded} className="activity-content">
        {expanded && children}
      </div>
    </div>
  );
}
