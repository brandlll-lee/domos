export type StatusTone = "positive" | "warning" | "negative" | "neutral";

export function StatusDot({
  tone,
  label,
  inline = false,
}: {
  tone: StatusTone;
  label: string;
  inline?: boolean;
}) {
  return (
    <span
      className="status-dot"
      data-tone={tone}
      data-inline={inline || undefined}
      role="img"
      aria-label={label}
    />
  );
}
