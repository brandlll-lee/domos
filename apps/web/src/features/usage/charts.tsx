import { type CSSProperties, useMemo, useState } from "react";
import {
  dayLabel,
  formatAxis,
  formatValue,
  type Metric,
  metricUnit,
  type UsageGroup,
  type UsageRecord,
  usageValue,
} from "./data.ts";

export function DailyChart({
  days,
  groups,
  metric,
}: {
  days: { day: string; rows: UsageRecord[] }[];
  groups: UsageGroup[];
  metric: Metric;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const bars = useMemo(() => {
    const series = groups.map((group) => new Set(group.rows));
    return days.map((day) => {
      const values = series.map((set) =>
        usageValue(
          day.rows.filter((row) => set.has(row)),
          metric,
        ),
      );
      return {
        day: day.day,
        values,
        total: values.reduce<number>((sum, value) => sum + (value ?? 0), 0),
      };
    });
  }, [days, groups, metric]);
  const max = Math.max(...bars.map((bar) => bar.total), 0);
  const decimals = max >= 100 ? 0 : max >= 0.1 ? 2 : 4;
  const ticks = [1, 2 / 3, 1 / 3];
  const last = bars.length - 1;
  const labeled = new Set([
    0,
    Math.round(last / 3),
    Math.round((last * 2) / 3),
    last,
  ]);
  const active = hovered === null ? null : bars[hovered];
  if (!max) return <p className="usage-muted">该指标未提供原生数据。</p>;
  const pick = (element: HTMLElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    setHovered(Math.min(last, Math.max(0, Math.floor(ratio * bars.length))));
  };
  return (
    <div className="usage-chart" data-hover={hovered !== null || undefined}>
      <div className="usage-chart-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ bottom: `${tick * 100}%` }}>
            {formatAxis(max * tick, metric, decimals)}
          </span>
        ))}
      </div>
      <div className="usage-plot">
        <div className="usage-chart-grid" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ bottom: `${tick * 100}%` }} />
          ))}
        </div>
        <div
          className="usage-bars"
          role="img"
          aria-label={`每日${metric === "cost" ? "成本" : "用量"}趋势，${bars[0]?.day} 至 ${bars.at(-1)?.day}，峰值 ${formatValue(max, metric)} ${metricUnit(metric)}`}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse")
              pick(event.currentTarget, event.clientX);
          }}
          onPointerDown={(event) => pick(event.currentTarget, event.clientX)}
          onPointerLeave={() => setHovered(null)}
        >
          {bars.map((bar, index) => (
            <div
              className="usage-bar"
              key={bar.day}
              data-active={hovered === index || undefined}
              title={`${bar.day} · ${formatValue(bar.total, metric)} ${metricUnit(metric)}`}
            >
              {bar.total ? (
                <span className="usage-bar-stack">
                  {bar.values.map((value, slot) =>
                    value ? (
                      <span
                        key={groups[slot]?.key}
                        style={
                          {
                            height: `${(value / max) * 100}%`,
                            "--segment": groups[slot]?.color,
                          } as CSSProperties
                        }
                      />
                    ) : null,
                  )}
                </span>
              ) : (
                <span className="usage-bar-tick" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
        {hovered !== null && (
          <span
            className="usage-cursor"
            aria-hidden="true"
            style={{
              insetInlineStart: `${((hovered + 0.5) * 100) / bars.length}%`,
            }}
          />
        )}
        {active && (
          <div
            className="usage-tip"
            data-align={
              hovered === 0 ? "start" : hovered === last ? "end" : "center"
            }
            style={{
              insetInlineStart: `${((hovered ?? 0) + 0.5) * (100 / bars.length)}%`,
            }}
          >
            <span className="usage-tip-day">{dayLabel(active.day)}</span>
            <strong className="usage-tip-total">
              {formatValue(active.total, metric)}
              <small>{metricUnit(metric)}</small>
            </strong>
            {groups.length > 1 && (
              <ul>
                {groups.map((group, slot) =>
                  active.values[slot] ? (
                    <li key={group.key}>
                      <i style={{ background: group.color }} />
                      <span>{group.label}</span>
                      <b>{formatValue(active.values[slot], metric)}</b>
                    </li>
                  ) : null,
                )}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="usage-chart-dates" aria-hidden="true">
        {bars.map((bar, index) =>
          labeled.has(index) ? (
            <span
              key={bar.day}
              data-align={
                index === 0 ? "start" : index === last ? "end" : undefined
              }
              style={{
                insetInlineStart: `${((index + 0.5) * 100) / bars.length}%`,
              }}
            >
              {dayLabel(bar.day)}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

export function Legend({ groups }: { groups: UsageGroup[] }) {
  return (
    <ul className="usage-legend">
      {groups.map((group) => (
        <li key={group.key} title={group.label}>
          <i style={{ background: group.color }} />
          <span>{group.label}</span>
        </li>
      ))}
    </ul>
  );
}
