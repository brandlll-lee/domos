import { SegmentedControl } from "@domos/ui/choice";
import { Button } from "@domos/ui/controls";
import { ChoicePicker } from "@domos/ui/picker";
import { ScrollArea } from "@domos/ui/scroll-area";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
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
  type UsageSummary,
  usagePeriodRange,
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
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<UsageSummary>();
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
  const filter = useMemo(
    () => ({
      from: Date.parse(`${range.from}T00:00:00Z`),
      to: Date.parse(`${range.to}T23:59:59.999Z`),
      harness: harness || undefined,
      provider: provider || undefined,
      model: model || undefined,
      botId: botId ? Number(botId) : undefined,
      query: query.trim() || undefined,
    }),
    [range, harness, provider, model, botId, query],
  );
  useEffect(() => {
    void client.bots
      .list()
      .then(setBots)
      .catch((cause) => setError(userError(cause, "Bot 读取失败。")));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const started = performance.now();
    setLoading(true);
    setError("");
    void client.engines
      .usageSummary(
        { ...filter, dimension, metric, limit: Number(limit) },
        {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30_000),
          ]),
        },
      )
      .then((value) => {
        if (!controller.signal.aborted) {
          setSummary(value);
          setElapsed(Math.round(performance.now() - started));
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(userError(cause, "用量读取失败。请重试。"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filter, dimension, metric, limit]);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setReading(true);
    void client.engines
      .usage(
        { ...filter, page },
        {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30_000),
          ]),
        },
      )
      .then((value) => {
        if (!controller.signal.aborted) {
          setRows(value.items);
          setTotal(value.total);
          setPage(value.page);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(userError(cause, "明细读取失败。请重试。"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setReading(false);
      });
    return () => controller.abort();
  }, [filter, page]);
  const names = new Map(bots.map((bot) => [bot.id, bot.name]));
  const groups = (summary?.groups ?? []).map((group, index) => ({
    ...group,
    label:
      group.key === "other"
        ? "其他"
        : dimension === "bot"
          ? (names.get(Number(group.key)) ?? `Bot ${group.key}`)
          : dimension === "harness"
            ? (harnesses.find((item) => item.value === group.key)?.label ??
              group.key)
            : group.key,
    color:
      group.key === "other"
        ? "var(--color-chart-other)"
        : `var(--color-chart-${(index % 5) + 1})`,
  }));
  const days = summary ? dailyUsage(summary, groups, range.from, range.to) : [];
  const totals = summary?.totals;
  const daily = summary?.days ?? [];
  const change = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };
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
    setPage(1);
  };
  const options = (values: (string | null)[], all: string) => [
    { value: "", label: all },
    ...[...new Set(values.filter((value): value is string => value !== null))]
      .sort()
      .map((value) => ({ value, label: value })),
  ];
  return (
    <ScrollArea className="usage-surface">
      <main className="usage-page" aria-label="用量" aria-busy={loading}>
        <header className="usage-head">
          <div className="usage-head-text">
            <h1>用量</h1>
            <p>查看任务用量、引擎报告与价格估算。</p>
          </div>
          <div className="usage-head-actions">
            <span className="usage-timezone">UTC</span>
            <ChoicePicker
              label="日期范围"
              size="small"
              value={period}
              onValueChange={(value) => {
                setPeriod(value as UsagePeriod);
                setPage(1);
              }}
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
            onChange={change(setHarness)}
            items={[{ value: "", label: "Harness" }, ...harnesses]}
          />
          <Filter
            label="Provider"
            value={provider}
            onChange={change(setProvider)}
            items={options(
              (summary?.options ?? []).map((row) => row.provider),
              "Provider",
            )}
          />
          <Filter
            label="Bot"
            value={botId}
            onChange={change(setBotId)}
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
            onChange={change(setModel)}
            items={options(
              (summary?.options ?? []).map((row) => row.model),
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
        ) : !summary && loading ? (
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
        ) : totals ? (
          <>
            <section className="usage-hero" aria-label="用量总览">
              <div className="usage-hero-main">
                <span className="usage-hero-kicker">已知任务成本</span>
                <strong className="usage-hero-value">
                  {money(totals.cost)}
                </strong>
                <p className="usage-hero-meta">
                  USD · {periods.find((item) => item.value === period)?.label} ·{" "}
                  {totals.tasks} 个任务 · {totals.records} 条记录 ·{" "}
                  {totals.unpriced} 条成本未提供
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
                <SegmentedControl
                  label="统计指标"
                  value={metric}
                  onValueChange={setMetric}
                  options={metrics}
                />
              </header>
              <DailyChart days={days} groups={groups} metric={metric} />
              {groups.length > 1 && <Legend groups={groups} />}
            </section>
            <section className="usage-section" aria-label="构成">
              <header className="usage-section-head">
                <h2>构成</h2>
                <div className="usage-section-tools">
                  <SegmentedControl
                    label="分组维度"
                    value={dimension}
                    onValueChange={setDimension}
                    options={dimensions}
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
                total={totals[metric]}
              />
            </section>
            <section className="usage-section" aria-label="用量明细">
              <header className="usage-section-head">
                <h2>全部记录</h2>
                {totals.records === 0 && (
                  <span role="status">此范围还没有用量记录。</span>
                )}
                <span className="usage-section-meta">
                  {totals.tasks} 个任务 · {totals.records} 条
                </span>
              </header>
              <Records
                rows={rows}
                names={names}
                query={query}
                onQuery={change(setQuery)}
                page={page}
                total={total}
                onPage={setPage}
                loading={reading}
              />
            </section>
            <footer className="usage-footer">
              <span>
                {totals.tasks} 个任务 · {totals.records} 条用量记录 · {elapsed}
                ms 读取
              </span>
              <span>
                {totals.unpriced} 条成本未提供 · {totals.estimated} 条价格估算 ·{" "}
                {totals.snapshots} 条会话累计
              </span>
            </footer>
            <p className="usage-note">
              UTC · USD。估算为标准 API
              等值，不代表订阅扣款。原生零值不代表免费。会话累计快照不计入任务总额。
            </p>
          </>
        ) : null}
      </main>
    </ScrollArea>
  );
}
