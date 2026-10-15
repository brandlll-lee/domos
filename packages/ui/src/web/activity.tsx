import type { ReactNode } from "react";

export function ActivityText({
  active = false,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="activity-text" data-active={active || undefined}>
      <svg
        className="activity-indicator"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="5" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="19" cy="12" r="2" />
      </svg>
      <span className="activity-label">{children}</span>
    </span>
  );
}

export function ActivityDisclosure({
  label,
  active = false,
  attention = false,
  notice,
  children,
}: {
  label: string;
  active?: boolean;
  attention?: boolean;
  notice?: string;
  children: ReactNode;
}) {
  return (
    <details
      key={active ? "running" : "settled"}
      className="activity-disclosure"
      open={active}
      data-attention={attention || undefined}
    >
      <summary className="activity-summary" title={label}>
        <span role="status" aria-live="polite" aria-atomic="true">
          <ActivityText active={active}>{label}</ActivityText>
        </span>
        {notice && <span className="activity-notice">{notice}</span>}
        <span className="activity-chevron" aria-hidden="true" />
      </summary>
      <div className="activity-content">{children}</div>
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
  return (
    <details className="activity-step" data-attention={attention || undefined}>
      <summary className="activity-step-summary">
        <span className="activity-chevron" aria-hidden="true" />
        <span className="activity-step-label" title={label}>
          {label}
        </span>
        <span className="activity-step-status">{status}</span>
      </summary>
      <div className="activity-detail">{children}</div>
    </details>
  );
}
