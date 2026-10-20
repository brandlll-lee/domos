import type { CSSProperties } from "react";
import {
  formatValue,
  type Metric,
  type UsageGroup,
  type UsageRecord,
  usageValue,
} from "./usage-data.ts";

export function Sparkline({ values }: { values: (number | null)[] }) {
  if (!values.some((value) => value !== null)) return null;
  const maximum = Math.max(1, ...values.map((value) => value ?? 0));
  const points = values
    .map(
      (value, index) =>
        `${(index * 100) / Math.max(1, values.length - 1)},${30 - ((value ?? 0) / maximum) * 28}`,
    )
    .join(" ");
  return (
    <svg className="usage-sparkline" viewBox="0 0 100 32" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

export function UsageBreakdown({
  groups,
  metric,
}: {
  groups: UsageGroup[];
  metric: Metric;
}) {
  const total = groups.reduce((sum, group) => sum + (group.value ?? 0), 0);
  return (
    <>
      <div
        className="usage-stack"
        role="img"
        aria-label={groups
          .map((group) => `${group.label} ${formatValue(group.value, metric)}`)
          .join("；")}
      >
        {groups.map((group) => (
          <span
            key={group.key}
            style={{ flex: group.value ?? 0, background: group.color }}
            title={`${group.label} ${formatValue(group.value, metric)}`}
          />
        ))}
      </div>
      <ul className="usage-legend">
        {groups.map((group) => (
          <li key={group.key} title={group.label}>
            <i style={{ background: group.color }} />
            <span>{group.label}</span>
            <small>
              {total && group.value !== null
                ? `${(((group.value ?? 0) / total) * 100).toFixed(1)}%`
                : "—"}
            </small>
          </li>
        ))}
      </ul>
      <div className="usage-table-scroll">
        <table className="usage-table usage-summary" aria-label="分组用量">
          <thead>
            <tr>
              <th scope="col">名称</th>
              <th scope="col">
                {metric === "cost"
                  ? "任务成本 · USD"
                  : metric === "tasks"
                    ? "任务数"
                    : "用量 · tok"}
              </th>
              <th scope="col">占已报告总量</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const share =
                total && group.value !== null
                  ? (group.value / total) * 100
                  : null;
              return (
                <tr key={group.key}>
                  <th scope="row" title={group.label}>
                    <i
                      className="usage-dot"
                      style={{ background: group.color }}
                    />
                    {group.label}
                  </th>
                  <td>{formatValue(group.value, metric)}</td>
                  <td>
                    <span className="usage-share">
                      <span className="usage-track">
                        <span
                          style={{
                            width: `${share ?? 0}%`,
                            background: group.color,
                          }}
                        />
                      </span>
                      {share === null ? "—" : `${share.toFixed(1)}%`}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function UsageTimeline({
  days,
  groups,
  metric,
}: {
  days: { day: string; rows: UsageRecord[] }[];
  groups: UsageGroup[];
  metric: Metric;
}) {
  const series = groups.map((group) => new Set(group.rows));
  const bars = days.map((day) => ({
    day: day.day,
    values: series.map((set) =>
      usageValue(
        day.rows.filter((row) => set.has(row)),
        metric,
      ),
    ),
  }));
  const max = Math.max(
    1,
    ...bars.map((bar) =>
      bar.values.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    ),
  );
  if (!bars.some((bar) => bar.values.some((value) => value !== null)))
    return <p className="usage-empty">该指标未提供原生数据。</p>;
  return (
    <div className="usage-timeline">
      <div className="usage-axis" aria-hidden="true">
        {[1, 0.5, 0].map((fraction) => (
          <span key={fraction}>{formatValue(max * fraction, metric)}</span>
        ))}
      </div>
      <div className="usage-plot">
        <div className="usage-grid" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div
          className="usage-bars"
          role="img"
          aria-label={`每日${metric === "cost" ? "任务成本" : "用量"}，UTC。${bars.map((bar) => `${bar.day}: ${formatValue(usageValue(days.find((day) => day.day === bar.day)?.rows ?? [], metric), metric)}`).join("；")}`}
        >
          {bars.map((bar) => (
            <div
              className="usage-bar"
              key={bar.day}
              title={`${bar.day} · ${bar.values.map((value, index) => `${groups[index]?.label} ${formatValue(value, metric)}`).join(" / ")}`}
            >
              {bar.values.map((value, index) => (
                <span
                  key={groups[index]?.key}
                  style={
                    {
                      height: `${((value ?? 0) / max) * 100}%`,
                      background: groups[index]?.color,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          ))}
        </div>
        <div className="usage-dates">
          <span>{days[0]?.day}</span>
          <span>{days.at(-1)?.day}</span>
        </div>
      </div>
    </div>
  );
}
