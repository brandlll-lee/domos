import { type ReactNode, useState } from "react";
import { Disclosure } from "./disclosure.tsx";

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
    <Disclosure
      className="activity-step"
      data-attention={attention || undefined}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      label={
        <>
          <span className="activity-step-label" title={label}>
            {label}
          </span>
          <span className="activity-step-status">{status}</span>
        </>
      }
    >
      {expanded && <div className="activity-detail">{children}</div>}
    </Disclosure>
  );
}
