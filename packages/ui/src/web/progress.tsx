import type { StatusTone } from "./status-dot.tsx";

export function Progress({
  value,
  label,
  tone = "default",
}: {
  value: number | null;
  label: string;
  tone?: "default" | StatusTone;
}) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null ? "未提供" : undefined}
      data-tone={tone}
    >
      <span style={{ transform: `scaleX(${(value ?? 0) / 100})` }} />
    </div>
  );
}
