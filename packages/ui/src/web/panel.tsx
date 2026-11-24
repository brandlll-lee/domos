import { type ComponentProps, type ReactNode, type Ref, useId } from "react";
import { Button } from "./controls.tsx";

export function PanelHeader({
  title,
  onBack,
  onClose,
  actions,
  backLabel = "返回",
  backRef,
}: {
  title: string;
  onBack?: () => void;
  onClose: () => void;
  actions?: ReactNode;
  backLabel?: string;
  backRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <header
      className="panel-header"
      data-actions={Boolean(actions) || undefined}
    >
      {onBack ? (
        <Button
          ref={backRef}
          variant="ghost"
          size="icon-small"
          aria-label={backLabel}
          onClick={onBack}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path
              d="m12 4-6 6 6 6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
      ) : (
        <span />
      )}
      <h2>{title}</h2>
      <div className="panel-header-actions">
        {actions}
        <Button
          variant="ghost"
          size="icon-small"
          aria-label="关闭"
          onClick={onClose}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
          </svg>
        </Button>
      </div>
    </header>
  );
}

export function PanelCard({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`panel-card ${className}`} {...props} />;
}

export function PanelGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel-group" aria-label={title}>
      <h3 className="panel-group-title">{title}</h3>
      <PanelCard>{children}</PanelCard>
    </section>
  );
}

export function PanelRow({
  id,
  icon,
  title,
  value,
  description,
  preview = false,
  variant = "setting",
  onClick,
  ...props
}: {
  id?: string;
  icon?: ReactNode;
  title: string;
  value?: ReactNode;
  description?: string;
  preview?: boolean;
  variant?: "setting" | "navigation";
  onClick: () => void;
} & Omit<ComponentProps<"button">, "title" | "value" | "onClick">) {
  return (
    <button
      id={id}
      type="button"
      className="panel-row"
      data-preview={preview || undefined}
      data-variant={variant}
      onClick={onClick}
      {...props}
    >
      {icon && (
        <span className="panel-row-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="panel-row-content">
        <span className="panel-row-label" title={preview ? undefined : title}>
          {title}
        </span>
        {description && (
          <span className="panel-row-description">{description}</span>
        )}
      </span>
      <span
        className="panel-row-value"
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </span>
      <svg
        className="panel-row-caret"
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="m6 4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function ExpandableCard({
  title,
  icon,
  description,
  value,
  expanded,
  onExpandedChange,
  children,
  className = "",
  ...props
}: {
  title: string;
  icon: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
} & Omit<
  ComponentProps<"button">,
  "title" | "value" | "children" | "onClick"
>) {
  const id = useId();
  return (
    <PanelCard className={`expandable-card ${className}`}>
      <button
        {...props}
        type="button"
        className="expandable-card-trigger"
        aria-label={`查看 ${title}`}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => onExpandedChange(!expanded)}
      >
        <span className="expandable-card-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="expandable-card-identity">
          <strong>{title}</strong>
          {description && <span>{description}</span>}
        </span>
        <span className="expandable-card-value">{value}</span>
        <svg
          className="expandable-card-caret"
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      <div id={id} hidden={!expanded} className="expandable-card-body">
        {expanded && children}
      </div>
    </PanelCard>
  );
}
