import { useId, useState } from "react";
import { dayLabel, formatAxis, formatValue, type Metric } from "./data.ts";

export function DailyChart({
  days,
  metric,
}: {
  days: { day: string; value: number | null }[];
  metric: Metric;
}) {
  const fillId = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const known = days.filter((day) => day.value !== null);
  const max = Math.max(...known.map((day) => day.value ?? 0), 0);
  const scale = max || 1;
  const x = (index: number) =>
    days.length < 2 ? 500 : (index / (days.length - 1)) * 1000;
  const y = (value: number) => 230 - (value / scale) * 220;
  const segments: { index: number; value: number }[][] = [];
  days.forEach((day, index) => {
    if (day.value === null) return;
    if (index === 0 || days[index - 1]?.value === null) segments.push([]);
    segments.at(-1)?.push({ index, value: day.value });
  });
  const active = hovered === null ? undefined : days[hovered];
  return (
    <div className="usage-chart">
      <div className="usage-chart-axis" aria-hidden="true">
        {[1, 0.5, 0].map((tick) => (
          <span
            key={tick}
            style={{ top: `${((10 + (1 - tick) * 220) / 240) * 100}%` }}
          >
            {formatAxis(scale * tick, metric)}
          </span>
        ))}
      </div>
      <div className="usage-plot">
        <svg
          viewBox="0 0 1000 240"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--color-chart-1)"
                stopOpacity="0.13"
              />
              <stop
                offset="100%"
                stopColor="var(--color-chart-1)"
                stopOpacity="0"
              />
            </linearGradient>
          </defs>
          {[10, 120, 230].map((height) => (
            <line
              key={height}
              x1="0"
              x2="1000"
              y1={height}
              y2={height}
              className="usage-grid-line"
            />
          ))}
          {segments.map((segment) => {
            const first = segment[0]!;
            const last = segment.at(-1)!;
            const line = segment
              .map(
                (point, index) =>
                  `${index ? "L" : "M"}${x(point.index)},${y(point.value)}`,
              )
              .join(" ");
            return (
              <g key={first.index}>
                <path
                  d={`${line} L${x(last.index)},230 L${x(first.index)},230 Z`}
                  fill={`url(#${fillId})`}
                />
                <path d={line} className="usage-line" />
                {segment.length === 1 && (
                  <circle
                    cx={x(first.index)}
                    cy={y(first.value)}
                    r="2.5"
                    fill="var(--color-chart-1)"
                  />
                )}
              </g>
            );
          })}
        </svg>
        <div
          className="usage-chart-hit"
          role="slider"
          tabIndex={0}
          aria-label={`每日${metric === "cost" ? "费用" : "用量"}趋势`}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, days.length - 1)}
          aria-valuenow={hovered ?? 0}
          aria-valuetext={
            active
              ? `${active.day} ${formatValue(active.value, metric)}`
              : "使用方向键查看每日数据"
          }
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setHovered(
              Math.max(
                0,
                Math.min(
                  days.length - 1,
                  Math.round(
                    ((event.clientX - rect.left) / rect.width) *
                      (days.length - 1),
                  ),
                ),
              ),
            );
          }}
          onPointerLeave={() => setHovered(null)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              setHovered(
                Math.max(
                  0,
                  Math.min(
                    days.length - 1,
                    (hovered ?? 0) + (event.key === "ArrowRight" ? 1 : -1),
                  ),
                ),
              );
            }
          }}
        />
        {!known.length && (
          <p className="usage-chart-empty">此范围暂无可用数据</p>
        )}
        {active && (
          <div
            className="usage-tip"
            style={{
              insetInlineStart: `${Math.min(82, Math.max(18, ((hovered ?? 0) / Math.max(1, days.length - 1)) * 100))}%`,
            }}
          >
            <span>{dayLabel(active.day)}</span>
            <strong>{formatValue(active.value, metric)}</strong>
            {active.value === null && <small>未返回数据</small>}
          </div>
        )}
      </div>
      <div className="usage-chart-dates" aria-hidden="true">
        {[0, Math.round((days.length - 1) / 2), days.length - 1]
          .filter((index, slot, all) => all.indexOf(index) === slot)
          .map((index) => (
            <span key={index}>
              {days[index] ? dayLabel(days[index].day) : ""}
            </span>
          ))}
      </div>
    </div>
  );
}
