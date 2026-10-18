import { type ReactNode, useState } from "react";

export function ActivityText({
  active = false,
  children,
  indicator,
}: {
  active?: boolean;
  children: ReactNode;
  indicator?: ReactNode;
}) {
  return (
    <span className="activity-text" data-active={active || undefined}>
      {indicator ?? (
        <svg
          className="activity-indicator"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      )}
      <span className="activity-label">{children}</span>
    </span>
  );
}

export function ActivityDisclosure({
  label,
  attention = false,
  notice,
  children,
}: {
  label: string;
  attention?: boolean;
  notice?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="activity-disclosure"
      data-attention={attention || undefined}
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setExpanded(event.currentTarget.open);
      }}
    >
      <summary className="activity-summary" title={label}>
        <span role="status" aria-live="polite" aria-atomic="true">
          <ActivityText>{label}</ActivityText>
        </span>
        {notice && <span className="activity-notice">{notice}</span>}
        <span className="activity-chevron" aria-hidden="true" />
      </summary>
      {expanded && <div className="activity-content">{children}</div>}
    </details>
  );
}

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
