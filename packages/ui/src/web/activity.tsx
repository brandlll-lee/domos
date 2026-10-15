import { type ReactNode, useEffect, useRef } from "react";

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
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!active && disclosure.current) disclosure.current.open = false;
  }, [active]);
  return (
    <details
      className="activity-disclosure"
      ref={disclosure}
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
