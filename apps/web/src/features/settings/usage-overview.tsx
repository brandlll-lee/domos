import { Button } from "@domos/ui/controls";
import { Sparkline, UsageTimeline } from "./usage-charts.tsx";
import {
  type Dimension,
  type dailyUsage,
  formatValue,
  type Metric,
  metrics,
  type UsageGroup,
  type UsageRecord,
  usageGroups,
  usageValue,
} from "./usage-data.ts";

export function UsageOverview({
  visible,
  names,
  days,
  groups,
  metric,
  setMetric,
  explore,
}: {
  visible: UsageRecord[];
  names: Map<number, string>;
  days: ReturnType<typeof dailyUsage>;
  groups: UsageGroup[];
  metric: Metric;
  setMetric: (metric: Metric) => void;
  explore: (dimension: Dimension) => void;
}) {
  return (
    <>
      <div className="usage-kpis">
        {metrics.map((item) => {
          const value = usageValue(visible, item.value);
          return (
            <button
              type="button"
              key={item.value}
              className="usage-kpi"
              aria-pressed={metric === item.value}
              onClick={() => setMetric(item.value)}
            >
              <span>{item.label}</span>
              <strong>
                {formatValue(value, item.value)}
                <small>{item.unit}</small>
              </strong>
              <small>已报告数据 · 未比较上期</small>
              <Sparkline
                values={days.map((day) => usageValue(day.rows, item.value))}
              />
            </button>
          );
        })}
      </div>
      <div className="usage-rankings">
        {(["provider", "harness"] as const).map((kind) => (
          <section className="usage-card" key={kind}>
            <header>
              <h3>{kind === "provider" ? "Provider 排行" : "Harness 排行"}</h3>
              <Button
                size="small"
                variant="ghost"
                onClick={() => explore(kind)}
              >
                查看分析 ›
              </Button>
            </header>
            <ol className="usage-ranking">
              {usageGroups(visible, kind, metric, names, 5).map(
                (group, index) => (
                  <li key={group.key}>
                    <span className="usage-rank">{index + 1}</span>
                    <i
                      className="usage-dot"
                      style={{ background: group.color }}
                    />
                    <div>
                      <span title={group.label}>{group.label}</span>
                      <small
                        title={group.rows
                          .map((row) => row.model ?? "未提供")
                          .join(" / ")}
                      >
                        {[
                          ...new Set(
                            group.rows.map((row) => row.model ?? "未提供"),
                          ),
                        ].join(" / ")}
                      </small>
                    </div>
                    <strong>
                      {formatValue(group.value, metric)}
                      <small>
                        {metrics.find((item) => item.value === metric)?.unit}
                      </small>
                    </strong>
                  </li>
                ),
              )}
            </ol>
          </section>
        ))}
      </div>
      <section className="usage-card">
        <header>
          <h3>{metrics.find((item) => item.value === metric)?.label}趋势</h3>
          <Button variant="ghost" size="small" onClick={() => explore("model")}>
            按模型分析 ›
          </Button>
        </header>
        <UsageTimeline days={days} groups={groups} metric={metric} />
        <ul className="usage-legend">
          {groups.map((group) => (
            <li key={group.key} title={group.label}>
              <i style={{ background: group.color }} />
              <span>{group.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
