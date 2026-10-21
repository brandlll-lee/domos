import { Button } from "@domos/ui/controls";
import { ChoicePicker } from "@domos/ui/picker";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar";
import { useEffect, useMemo, useState } from "react";
import { client } from "../../client.ts";
import { userError } from "../user-error.ts";
import { DailyChart, Legend } from "./charts.tsx";
import {
  compactNumber,
  type Dimension,
  dailyUsage,
  dayLabel,
  dimensions,
  harnesses,
  type Metric,
  metrics,
  money,
  type UsagePeriod,
  type UsageRecord,
  usageGroups,
  usagePeriodRange,
  usageTotals,
  usageValue,
} from "./data.ts";
import { Breakdown, Records } from "./tables.tsx";
import "./style.css";

const periods = [
  { value: "month", label: "本月" },
  { value: "lastMonth", label: "上月" },
  { value: "days30", label: "近 30 天" },
];
const limits = [
  { value: "5", label: "Top 5" },
  { value: "10", label: "Top 10" },
  { value: "20", label: "Top 20" },
];

function Segmented<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: T;
  items: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="usage-segment" aria-label={label}>
      {items.map((item) => (
        <button
          type="button"
          key={item.value}
          aria-pressed={item.value === value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </fieldset>
  );
}

function Filter({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <span className="usage-chip" data-active={Boolean(value) || undefined}>
      <ChoicePicker
        label={label}
        size="small"
        value={value}
        onValueChange={onChange}
        items={items}
      />
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="usage-kpi">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function UsageSurface() {
  const [period, setPeriod] = useState<UsagePeriod>("month");
  const [harness, setHarness] = useState("");
  const [provider, setProvider] = useState("");
  const [botId, setBotId] = useState("");
  const [model, setModel] = useState("");
  const [rows, setRows] = useState<UsageRecord[]>([]);
  const [bots, setBots] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [reload, setReload] = useState(0);
  const [metric, setMetric] = useState<Metric>("cost");
  const [dimension, setDimension] = useState<Dimension>("model");
  const [limit, setLimit] = useState("5");
  const range = useMemo(
    () => ({ ...usagePeriodRange(period), attempt: reload }),
    [period, reload],
  );
  useEffect(() => {
    let current = true;
    const started = performance.now();
    setLoading(true);
    setError("");
    void Promise.all([
      client.engines.usage({
        from: Date.parse(`${range.from}T00:00:00Z`),
        to: Date.parse(`${range.to}T23:59:59.999Z`),
      }),
      client.bots.list(),
    ])
      .then(([rows, bots]) => {
        if (!current) return;
        setRows(rows);
        setBots(bots);
        setElapsed(Math.round(performance.now() - started));
      })
      .catch((cause) => {
        if (current) setError(userError(cause, "用量读取失败。请重试。"));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [range]);
  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!harness || row.harness === harness) &&
          (!provider || row.provider === provider) &&
          (!model || row.model === model) &&
          (!botId || String(row.botId) === botId),
      ),
    [rows, harness, provider, model, botId],
  );
  const names = new Map(bots.map((bot) => [bot.id, bot.name]));
  const days = dailyUsage(visible, range.from, range.to);
  const groups = usageGroups(visible, dimension, metric, names, Number(limit));
  const totals = usageTotals(visible);
  const daily = days.map((day) => ({
    day: day.day,
    cost: usageValue(day.rows, "cost"),
  }));
  const peak = daily.reduce(
    (best, item) =>
      item.cost !== null && (best.cost === null || item.cost > best.cost)
        ? item
        : best,
    { day: "", cost: null as number | null },
  );
  const activeDays = daily.filter((item) => item.cost !== null).length;
  const activeFilters = [harness, provider, botId, model].filter(
    Boolean,
  ).length;
  const refresh = () => setReload((value) => value + 1);
  const clearFilters = () => {
    setHarness("");
    setProvider("");
    setBotId("");
    setModel("");
  };
  const options = (values: (string | null)[], all: string) => [
    { value: "", label: all },
    ...[...new Set(values.filter((value): value is string => value !== null))]
      .sort()
      .map((value) => ({ value, label: value })),
  ];
  return (
    <main className="usage-surface" aria-label="用量" aria-busy={loading}>
      <div className="usage-page">
        <header className="usage-head">
          <div className="usage-head-text">
            <h1>用量</h1>
            <p>按 Provider、Harness、Bot 与模型查看引擎原生用量与成本。</p>
          </div>
          <div className="usage-head-actions">
            <span className="usage-timezone">UTC</span>
            <ChoicePicker
              label="日期范围"
              size="small"
              value={period}
              onValueChange={(value) => setPeriod(value as UsagePeriod)}
              items={periods}
            />
            <Button
              size="small"
              variant="secondary"
              aria-label="刷新用量"
              title="刷新用量"
              disabled={loading}
              onClick={refresh}
            >
              <ArrowClockwiseIcon />
            </Button>
          </div>
        </header>
        <fieldset className="usage-filters" aria-label="筛选用量">
          <Filter
            label="Harness"
            value={harness}
            onChange={setHarness}
            items={[{ value: "", label: "Harness" }, ...harnesses]}
          />
          <Filter
            label="Provider"
            value={provider}
            onChange={setProvider}
            items={options(
              rows.map((row) => row.provider),
              "Provider",
            )}
          />
          <Filter
            label="Bot"
            value={botId}
            onChange={setBotId}
            items={[
              { value: "", label: "Bot" },
              ...bots.map((bot) => ({
                value: String(bot.id),
                label: bot.name,
              })),
            ]}
          />
          <Filter
            label="用量模型"
            value={model}
            onChange={setModel}
            items={options(
              rows.map((row) => row.model),
              "模型",
            )}
          />
          {activeFilters > 0 && (
            <Button size="small" variant="ghost" onClick={clearFilters}>
              清除
            </Button>
          )}
        </fieldset>
        {error ? (
          <div className="usage-error" role="alert">
            <p>{error}</p>
            <Button variant="secondary" size="small" onClick={refresh}>
              重试
            </Button>
          </div>
        ) : loading ? (
          <div
            className="usage-loading"
            role="status"
            aria-label="正在读取用量"
          >
            <div className="usage-skeleton usage-skeleton-hero" />
            <div className="usage-skeleton-stats" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((slot) => (
                <span className="usage-skeleton" key={slot} />
              ))}
            </div>
            <div className="usage-skeleton usage-skeleton-chart" />
          </div>
        ) : !visible.length ? (
          <div className="usage-empty" role="status">
            <ChartBarIcon size={26} weight="thin" aria-hidden="true" />
            <h2>此范围还没有用量记录。</h2>
            <p>任务完成后，引擎提供的用量会显示在这里。</p>
          </div>
        ) : (
          <>
            <section className="usage-hero" aria-label="用量总览">
              <div className="usage-hero-main">
                <span className="usage-hero-kicker">已报告任务成本</span>
                <strong className="usage-hero-value">
                  {money(totals.cost)}
                </strong>
                <p className="usage-hero-meta">
                  USD · {periods.find((item) => item.value === period)?.label} ·{" "}
                  {totals.tasks} 个任务 · {totals.records} 条记录
                </p>
              </div>
              <dl className="usage-facts">
                <div>
                  <dt>峰值日</dt>
                  <dd>
                    {peak.day ? dayLabel(peak.day) : "—"}
                    <small>{money(peak.cost)}</small>
                  </dd>
                </div>
                <div>
                  <dt>日均（有记录 {activeDays} 天）</dt>
                  <dd>
                    <small>
                      {activeDays
                        ? money((totals.cost ?? 0) / activeDays)
                        : "—"}
                    </small>
                  </dd>
                </div>
              </dl>
            </section>
            <dl className="usage-stats">
              <Stat label="任务数" value={compactNumber(totals.tasks)} />
              <Stat
                label="输入用量"
                value={
                  totals.input === null ? "—" : compactNumber(totals.input)
                }
              />
              <Stat
                label="输出用量"
                value={
                  totals.output === null ? "—" : compactNumber(totals.output)
                }
              />
              <Stat
                label="缓存读"
                value={
                  totals.cacheRead === null
                    ? "—"
                    : compactNumber(totals.cacheRead)
                }
              />
              <Stat
                label="缓存写"
                value={
                  totals.cacheWrite === null
                    ? "—"
                    : compactNumber(totals.cacheWrite)
                }
              />
            </dl>
            <section className="usage-section" aria-label="每日趋势">
              <header className="usage-section-head">
                <h2>
                  {metrics.find((item) => item.value === metric)?.label}趋势
                </h2>
                <Segmented
                  label="统计指标"
                  value={metric}
                  onChange={setMetric}
                  items={metrics}
                />
              </header>
              <DailyChart days={days} groups={groups} metric={metric} />
              {groups.length > 1 && <Legend groups={groups} />}
            </section>
            <section className="usage-section" aria-label="构成">
              <header className="usage-section-head">
                <h2>构成</h2>
                <div className="usage-section-tools">
                  <Segmented
                    label="分组维度"
                    value={dimension}
                    onChange={setDimension}
                    items={dimensions}
                  />
                  <ChoicePicker
                    label="显示数量"
                    size="small"
                    value={limit}
                    onValueChange={setLimit}
                    items={limits}
                  />
                </div>
              </header>
              <Breakdown
                groups={groups}
                metric={metric}
                dimension={dimension}
              />
            </section>
            <section className="usage-section" aria-label="用量明细">
              <header className="usage-section-head">
                <h2>全部记录</h2>
                <span className="usage-section-meta">
                  {new Set(visible.map((row) => row.taskId)).size} 个任务 ·{" "}
                  {visible.length} 条
                </span>
              </header>
              <Records rows={visible} names={names} />
            </section>
            <footer className="usage-footer">
              <span>
                {totals.tasks} 个任务 · {totals.records} 条用量记录 · {elapsed}
                ms 读取
              </span>
              <span>
                {totals.unpriced} 条成本未提供 · {totals.snapshots} 条会话累计
              </span>
            </footer>
            <p className="usage-note">
              仅显示引擎返回的数据 · UTC ·
              USD。任务成本不含会话累计快照；输入与缓存保留原生口径。
            </p>
          </>
        )}
      </div>
    </main>
  );
}
