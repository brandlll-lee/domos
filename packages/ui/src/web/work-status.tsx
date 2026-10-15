import { Tooltip } from "@base-ui/react/tooltip";
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
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger
            className="work-trigger"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded(!expanded)}
          >
            <ActivityText active indicator={avatar}>
              {label}
            </ActivityText>
            <span className="activity-chevron" aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner side="top" align="start" sideOffset={8}>
              <Tooltip.Popup className="work-tooltip">{summary}</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      <span className="sr-only" role="status">
        {summary}
      </span>
      <div id={id} hidden={!expanded} className="activity-content">
        {children}
      </div>
    </div>
  );
}
