export type StatusTone = "positive" | "warning" | "negative";

export function StatusDot({
  tone,
  label,
}: {
  tone: StatusTone;
  label: string;
}) {
  return (
    <span
      className="status-dot"
      data-tone={tone}
      role="img"
      aria-label={label}
    />
  );
}
