import type { ComponentProps, ReactNode } from "react";
import { Caret } from "./caret.tsx";

export function Disclosure({
  label,
  children,
  className = "",
  onToggle,
  ...props
}: ComponentProps<"details"> & { label: ReactNode }) {
  return (
    <details
      {...props}
      className={`disclosure ${className}`}
      onToggle={(event) => {
        if (event.target === event.currentTarget) onToggle?.(event);
      }}
    >
      <summary className="disclosure-heading">
        <span className="disclosure-label">{label}</span>
        <Caret />
      </summary>
      {children}
    </details>
  );
}
