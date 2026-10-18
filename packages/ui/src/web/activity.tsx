import { type ReactNode, useState } from "react";

export function ActivityDetails({
  label,
  status,
  attention = false,
  children,
}: {
  label: string;
  status: string;
  attention?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="activity-step"
      data-attention={attention || undefined}
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setExpanded(event.currentTarget.open);
      }}
    >
      <summary className="activity-step-summary">
        <span className="activity-chevron" aria-hidden="true" />
        <span className="activity-step-label" title={label}>
          {label}
        </span>
        <span className="activity-step-status">{status}</span>
      </summary>
      {expanded && <div className="activity-detail">{children}</div>}
    </details>
  );
}
