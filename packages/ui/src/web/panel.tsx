import type { ComponentProps, ReactNode } from "react";
import { Button } from "./controls.tsx";

export function PanelHeader({
  title,
  onBack,
  onClose,
  actions,
}: {
  title: string;
  onBack?: () => void;
  onClose: () => void;
  actions?: ReactNode;
}) {
  return (
    <header
      className="panel-header"
      data-actions={Boolean(actions) || undefined}
    >
      {onBack ? (
        <Button
          variant="ghost"
          size="icon-small"
          aria-label="返回"
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
  onClick,
}: {
  id?: string;
  icon?: ReactNode;
  title: string;
  value?: string;
  description?: string;
  preview?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      className="panel-row"
      data-preview={preview || undefined}
      onClick={onClick}
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
      <span className="panel-row-value" title={value}>
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
