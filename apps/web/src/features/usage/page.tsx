import type { EngineId } from "@domos/agent/harness/types";
import { SegmentedControl } from "@domos/ui/choice";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { ChoicePicker } from "@domos/ui/picker";
import { ScrollArea } from "@domos/ui/scroll-area";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { useEffect, useMemo, useState } from "react";
import { client } from "../../client.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import { userError } from "../user-error.ts";
import { DailyChart } from "./charts.tsx";
import {
  compactNumber,
  type Dimension,
  dailyUsage,
  dimensions,
  harnesses,
  type Metric,
  metrics,
  money,
  purposes,
  type UsagePeriod,
  type UsageRecord,
  type UsageSummary,
  usagePeriodRange,
} from "./data.ts";
import { QuotaPanel } from "./quota.tsx";
import { Breakdown, Records } from "./tables.tsx";
import "./style.css";

const periods = [
  { value: "month", label: "本月" },
  { value: "lastMonth", label: "上月" },
  { value: "days7", label: "近 7 天" },
  { value: "days30", label: "近 30 天" },
  { value: "days90", label: "近 90 天" },
  { value: "days365", label: "近一年" },
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
  const [summary, setSummary] = useState<
    UsageSummary & { dimension: Dimension }
  >();
  const [rows, setRows] = useState<UsageRecord[]>([]);
  const [bots, setBots] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [metric, setMetric] = useState<Metric>("cost");
  const [dimension, setDimension] = useState<Dimension>("model");
  const [analysisDimension, setAnalysisDimension] =
    useState<Dimension>("harness");
  const [view, setView] = useState<"cost" | "tokens" | "quota">("cost");
  const [panel, setPanel] = useState<
    "data" | "records" | "filters" | "analysis" | null
  >(null);
  const summaryDimension = panel === "analysis" ? analysisDimension : dimension;
  const [expanded, setExpanded] = useState(false);
  const [drill, setDrill] = useState<{ dimension: Dimension; key: string }>();
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
    }),
    [range, harness, provider, model, botId],
  );
  useEffect(() => {
    void client.bots
      .list()
      .then(setBots)
      .catch((cause) => setError(userError(cause, "Bot 读取失败。")));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void client.engines
      .usageSummary(
        { ...filter, dimension: summaryDimension, metric, limit: 20 },
        {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30_000),
          ]),
        },
      )
      .then((value) => {
        if (!controller.signal.aborted) {
          setSummary({ ...value, dimension: summaryDimension });
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
  }, [filter, summaryDimension, metric]);
  const [reading, setReading] = useState(false);
  const recordFilter = useMemo(
    () => ({
      ...filter,
      ...(drill?.dimension === "day"
        ? {
            from: Date.parse(`${drill.key}T00:00:00Z`),
            to: Date.parse(`${drill.key}T23:59:59.999Z`),
          }
        : drill
          ? {
              [drill.dimension === "bot" ? "botId" : drill.dimension]:
                drill.dimension === "bot" ? Number(drill.key) : drill.key,
            }
          : {}),
      query: query.trim() || undefined,
    }),
    [filter, drill, query],
  );
  useEffect(() => {
    if (panel !== "records") return;
    const controller = new AbortController();
    setReading(true);
    setError("");
    void client.engines
      .usage(
        { ...recordFilter, page },
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
  }, [recordFilter, page, panel]);
  const names = new Map(bots.map((bot) => [bot.id, bot.name]));
  const groups = (summary?.groups ?? []).map((group) => ({
    ...group,
    label:
      group.key === "other"
        ? "其他"
        : summary?.dimension === "bot"
          ? (names.get(Number(group.key)) ?? `Bot ${group.key}`)
          : summary?.dimension === "harness"
            ? (harnesses.find((item) => item.value === group.key)?.label ??
              group.key)
            : summary?.dimension === "purpose"
              ? (purposes[group.key] ?? group.key)
              : group.key,
  }));
  const days = summary ? dailyUsage(summary, metric, range.from, range.to) : [];
  const totals = summary?.totals;
  const change = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };
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
  const selectGroup = (key: string) => {
    if (
      !summary ||
      summary.dimension === "skill" ||
      summary.dimension === "purpose"
    )
      return;
    setDrill({ dimension: summary.dimension, key });
    setQuery("");
    setPage(1);
    setPanel("records");
  };
  const openRecords = () => {
    setDrill(undefined);
    setQuery("");
    setPage(1);
    setPanel("records");
  };
  const partial =
    summary &&
    (summary.missingUsage > 0 ||
      summary.totals.incomplete > 0 ||
      summary.totals.unpriced > 0 ||
      summary.totals.historical > 0);
  const scope = [
    harnesses.find((item) => item.value === harness)?.label,
    provider,
    names.get(Number(botId)),
    model,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <ScrollArea className="usage-surface">
      <main className="usage-page" aria-label="用量" aria-busy={loading}>
        <header className="usage-head">
          <h1>用量</h1>
          <div className="usage-head-actions">
            {view !== "quota" && (
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
            )}
            <SegmentedControl
              label="统计指标"
              value={view}
              onValueChange={(value) => {
                setView(value);
                if (value !== "quota") setMetric(value);
              }}
              options={[...metrics, { value: "quota", label: "订阅额度" }]}
            />
            {view !== "quota" && (
              <>
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => setPanel("filters")}
                >
                  筛选{activeFilters ? ` · ${activeFilters}` : ""}
                </Button>
                <Button
                  size="icon-small"
                  variant="ghost"
                  aria-label="刷新用量"
                  title="刷新用量"
                  pending={loading}
                  onClick={refresh}
                >
                  <ArrowClockwiseIcon />
                </Button>
              </>
            )}
          </div>
        </header>
        {view === "quota" && <QuotaPanel />}
        <div className="usage-overview" hidden={view === "quota"}>
          {activeFilters > 0 && (
            <div className="usage-active-filters">
              <span>{scope}</span>
              <Button size="small" variant="ghost" onClick={clearFilters}>
                清除筛选
              </Button>
            </div>
          )}
          {error && (
            <div className="usage-error" role="alert">
              <p>{error}</p>
              <Button size="small" variant="secondary" onClick={refresh}>
                重试
              </Button>
            </div>
          )}
          {partial && (
            <div className="usage-completeness">
              <span>
                部分用量尚不完整 · {summary.missingUsage} 个任务未返回用量 ·{" "}
                {totals?.unpriced} 条暂无法估价
              </span>
              <Button
                size="small"
                variant="ghost"
                onClick={() => setPanel("data")}
              >
                查看详情
              </Button>
            </div>
          )}
          {!summary && loading ? (
            <div
              className="usage-loading"
              role="status"
              aria-label="正在读取用量"
            >
              <div className="usage-skeleton usage-skeleton-hero" />
              <div className="usage-skeleton usage-skeleton-chart" />
            </div>
          ) : (
            totals && (
              <>
                <section className="usage-hero" aria-label="用量总览">
                  <div className="usage-hero-main">
                    <strong className="usage-hero-value">
                      {metric === "tokens"
                        ? totals.tokens === null
                          ? "—"
                          : compactNumber(totals.tokens)
                        : money(totals.cost)}
                    </strong>
                    <p className="usage-hero-meta">
                      {metric === "tokens"
                        ? "已知完整 Token"
                        : "已知费用 · USD"}{" "}
                      · {totals.tasks} 个任务
                    </p>
                    <ul className="usage-engines" aria-label="引擎用量">
                      {(expanded
                        ? summary.engines
                        : summary.engines.slice(0, 3)
                      ).map((engine) => (
                        <li key={engine.key}>
                          <div className="usage-engine-head">
                            <span>
                              <EngineMark provider={engine.key as EngineId} />
                              {harnesses.find(
                                (item) => item.value === engine.key,
                              )?.label ?? engine.key}
                            </span>
                            <b>
                              {metric === "tokens"
                                ? engine.tokens === null
                                  ? "—"
                                  : compactNumber(engine.tokens)
                                : money(engine.cost)}
                            </b>
                          </div>
                          <small>
                            {engine.cost !== null && totals.cost
                              ? `${((engine.cost / totals.cost) * 100).toFixed(1)}% 已知费用 · `
                              : ""}
                            {engine.tokens === null
                              ? "Token 未完整返回"
                              : `${compactNumber(engine.tokens)} Token`}
                          </small>
                        </li>
                      ))}
                    </ul>
                    {summary.engines.length > 3 && (
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() => setExpanded(!expanded)}
                      >
                        {expanded
                          ? "收起引擎"
                          : `查看全部 ${summary.engines.length} 个引擎`}
                      </Button>
                    )}
                  </div>
                  <section className="usage-trend" aria-label="每日趋势">
                    <header className="usage-section-head">
                      <h2>每日{metric === "cost" ? "费用" : "用量"}</h2>
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() => setDimension("day")}
                      >
                        查看每日数据
                      </Button>
                    </header>
                    <DailyChart days={days} metric={metric} />
                  </section>
                </section>
                {totals.records === 0 && (
                  <p className="usage-muted" role="status">
                    此范围还没有用量记录。
                  </p>
                )}
                <dl className="usage-stats">
                  {(
                    [
                      ["总 Token", totals.tokens],
                      ["缓存读取", totals.cacheRead],
                      ["未缓存输入", totals.input],
                      ["缓存写入", totals.cacheWrite],
                      ["输出", totals.output],
                    ] as const
                  ).map(([label, value]) => (
                    <Stat
                      key={label}
                      label={label}
                      value={value === null ? "—" : compactNumber(value)}
                    />
                  ))}
                </dl>
                <section className="usage-section" aria-label="用量构成">
                  <header className="usage-section-head">
                    <h2>用量构成</h2>
                    <SegmentedControl
                      label="分组维度"
                      value={dimension}
                      onValueChange={setDimension}
                      options={dimensions.filter((item) =>
                        ["model", "bot", "day"].includes(item.value),
                      )}
                    />
                  </header>
                  <Breakdown
                    groups={groups}
                    dimension={summary.dimension}
                    total={totals.cost}
                    onSelect={selectGroup}
                  />
                  <div className="usage-section-actions">
                    <Button size="small" variant="ghost" onClick={openRecords}>
                      查看记录
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => setPanel("analysis")}
                    >
                      更多分析
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => setPanel("data")}
                    >
                      数据说明
                    </Button>
                  </div>
                </section>
              </>
            )
          )}
        </div>
      </main>
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
        title={
          panel === "filters"
            ? "筛选用量"
            : panel === "records"
              ? "用量记录"
              : panel === "analysis"
                ? "更多分析"
                : "数据说明"
        }
        className="usage-dialog"
      >
        {panel === "filters" && (
          <fieldset className="usage-filters" aria-label="筛选用量">
            <Filter
              label="Harness"
              value={harness}
              onChange={change(setHarness)}
              items={[{ value: "", label: "全部引擎" }, ...harnesses]}
            />
            <Filter
              label="Provider"
              value={provider}
              onChange={change(setProvider)}
              items={options(
                (summary?.options ?? []).map((row) => row.provider),
                "全部 Provider",
              )}
            />
            <Filter
              label="Bot"
              value={botId}
              onChange={change(setBotId)}
              items={[
                { value: "", label: "全部 Bot" },
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
                "全部模型",
              )}
            />
            <Button size="small" variant="ghost" onClick={clearFilters}>
              清除筛选
            </Button>
          </fieldset>
        )}
        {panel === "data" && summary && (
          <section className="usage-data">
            <p>
              费用为引擎报告金额或标准 API
              等值估算，不代表订阅扣款。原生零值不代表免费。未知值不计为零。
            </p>
            <p>
              {summary.missingUsage} 个任务未返回用量 ·{" "}
              {summary.totals.incomplete} 条 Token 字段不完整 ·{" "}
              {summary.totals.unpriced} 条暂无法估价 ·{" "}
              {summary.totals.historical} 条历史口径待核对。
            </p>
            <p>
              {summary.totals.estimated} 条价格估算 · {summary.totals.snapshots}{" "}
              条会话累计快照。会话累计快照不计入任务总额。逐条计价依据见用量记录。
            </p>
            <p>
              统计范围：{range.from} 至 {range.to} · UTC · {scope || "全部 Bot"}
            </p>
            <p>
              采集起点：
              {summary.startedAt === null
                ? "未知"
                : new Date(summary.startedAt).toLocaleString()}
              <br />
              最新记录：
              {summary.updatedAt === null
                ? "未知"
                : new Date(summary.updatedAt).toLocaleString()}
            </p>
            <ul>
              {harnesses.map((item) => {
                const row = summary.coverage.find(
                  (row) => row.harness === item.value,
                );
                return (
                  <li key={item.value}>
                    {item.label}：{row?.tasks ?? 0} 个任务，
                    {row?.missingUsage ?? 0} 个未返回用量
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {panel === "analysis" && totals && (
          <>
            <ChoicePicker
              label="分析维度"
              value={analysisDimension}
              onValueChange={(value) =>
                setAnalysisDimension(value as Dimension)
              }
              items={dimensions.filter(
                (item) => !["model", "bot", "day"].includes(item.value),
              )}
            />
            {analysisDimension === "skill" && (
              <p className="usage-muted">
                按任务中的 skill_read
                调用关联。同一任务可关联多个技能，分组不可相加，不代表技能独立收费。
              </p>
            )}
            <Breakdown
              groups={groups}
              dimension={summary.dimension}
              total={totals.cost}
              onSelect={selectGroup}
            />
          </>
        )}
        {panel === "records" && (
          <>
            <div className="usage-section-head">
              <p className="usage-muted">
                {drill
                  ? `${dimensions.find((item) => item.value === drill.dimension)?.label}：${drill.dimension === "bot" ? (names.get(Number(drill.key)) ?? drill.key) : drill.key}`
                  : "当前范围全部记录"}
              </p>
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  const params = new URLSearchParams();
                  for (const [key, value] of Object.entries(recordFilter))
                    if (value !== undefined) params.set(key, String(value));
                  const link = document.createElement("a");
                  link.href = `/usage/export.csv?${params}`;
                  link.download = "domos-usage.csv";
                  link.click();
                }}
              >
                导出筛选记录
              </Button>
            </div>
            {error && (
              <div role="alert">
                {error}
                <Button size="small" variant="ghost" onClick={refresh}>
                  重试
                </Button>
              </div>
            )}
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
          </>
        )}
      </Dialog>
    </ScrollArea>
  );
}
