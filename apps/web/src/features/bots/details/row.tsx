import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import type { ReactNode } from "react";

export function PanelRow({
  icon,
  title,
  summary,
  value,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  summary: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="panel-row" onClick={onClick}>
      <span className="panel-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="panel-row-copy">
        <strong>{title}</strong>
        <span>{summary}</span>
      </span>
      {value && <span className="panel-row-value">{value}</span>}
      <CaretRightIcon className="panel-row-caret" aria-hidden="true" />
    </button>
  );
}
