import { Button } from "@domos/ui/controls";
import { ChoicePicker } from "@domos/ui/picker";
import { Tabs } from "@domos/ui/tabs";
import { ArrowsOutIcon } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { FunnelIcon } from "@phosphor-icons/react/dist/csr/Funnel";
import { useEffect, useMemo, useState } from "react";
import { client } from "../../client.ts";
import { userError } from "../user-error.ts";
import { UsageBreakdown } from "./usage-charts.tsx";
import {
  type Dimension,
  dailyUsage,
  dimensions,
  harnesses,
  type Metric,
  metrics,
  type UsageRecord,
  usageGroups,
} from "./usage-data.ts";
import { UsageDetails } from "./usage-details.tsx";
import { UsageOverview } from "./usage-overview.tsx";
import { type UsagePeriod, usagePeriodRange } from "./usage-period.ts";
import "./usage.css";

const choices = (values: (string | null)[]) => [
  { value: "", label: "全部" },
  ...[...new Set(values.filter((value): value is string => value !== null))]
    .sort()
    .map((value) => ({ value, label: value })),
];

export function UsageSettings() {
  const [query, setQuery] = useState({ period: "month" as UsagePeriod });
  const [harness, setHarness] = useState("");
  const [provider, setProvider] = useState("");
  const [botId, setBotId] = useState("");
  const [model, setModel] = useState("");
  const [rows, setRows] = useState<UsageRecord[]>([]);
  const [bots, setBots] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [tab, setTab] = useState("overview");
  const [filters, setFilters] = useState(false);
  const [metric, setMetric] = useState<Metric>("cost");
  const [dimension, setDimension] = useState<Dimension>("model");
  const [limit, setLimit] = useState("5");
  const [expanded, setExpanded] = useState(false);
  const range = useMemo(() => usagePeriodRange(query.period), [query]);
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
        if (current) {
          setRows(rows);
          setBots(bots);
          setElapsed(Math.round(performance.now() - started));
        }
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
  const explore = (next: Dimension) => {
    setDimension(next);
    setTab("explore");
  };
  return (
    <div
      className="usage-dashboard"
      aria-busy={loading}
      data-expanded={expanded || undefined}
    >
      <div className="usage-toolbar">
        <span className="usage-timezone">UTC</span>
        <Button
          size="small"
          variant="secondary"
          aria-label="筛选用量"
          aria-expanded={filters}
          aria-controls="usage-filters"
          onClick={() => setFilters(!filters)}
        >
          <FunnelIcon />
          筛选{[harness, provider, botId, model].filter(Boolean).length || ""}
        </Button>
        <ChoicePicker
          label="日期范围"
          size="small"
          value={query.period}
          onValueChange={(period) =>
            setQuery({ period: period as UsagePeriod })
          }
          items={[
            { value: "month", label: "本月" },
            { value: "lastMonth", label: "上月" },
            { value: "days30", label: "近 30 天" },
          ]}
        />
        <Button
          size="small"
          variant="secondary"
          disabled={loading}
          onClick={() => setQuery({ ...query })}
        >
          刷新用量
        </Button>
      </div>
      <div id="usage-filters" className="usage-filters" hidden={!filters}>
        <ChoicePicker
          label="Harness"
          size="small"
          value={harness}
          onValueChange={setHarness}
          items={[{ value: "", label: "全部 Harness" }, ...harnesses]}
        />
        <ChoicePicker
          label="Provider"
          size="small"
          value={provider}
          onValueChange={setProvider}
          items={choices(rows.map((row) => row.provider))}
        />
        <ChoicePicker
          label="Bot"
          size="small"
          value={botId}
          onValueChange={setBotId}
          items={[
            { value: "", label: "全部 Bot" },
            ...bots.map((bot) => ({ value: String(bot.id), label: bot.name })),
          ]}
        />
        <ChoicePicker
          label="用量模型"
          size="small"
          value={model}
          onValueChange={setModel}
          items={choices(rows.map((row) => row.model))}
        />
      </div>
      <Tabs.Root value={tab} onValueChange={setTab} className="usage-tabs">
        <Tabs.List aria-label="用量视图" className="usage-tablist">
          {[
            { value: "overview", label: "总览" },
            { value: "explore", label: "分析" },
            { value: "details", label: "明细" },
          ].map((item) => (
            <Tabs.Tab key={item.value} value={item.value}>
              {item.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <p className="usage-note">
          仅显示引擎返回的数据 · UTC ·
          USD。任务成本不含会话累计快照；输入与缓存保留原生口径。
        </p>
        {error ? (
          <div className="usage-empty" role="alert">
            <p>{error}</p>
            <Button
              variant="secondary"
              size="small"
              onClick={() => setQuery({ ...query })}
            >
              重试
            </Button>
          </div>
        ) : loading ? (
          <div className="usage-kpis" role="status" aria-label="正在读取用量">
            {metrics.map((item) => (
              <div className="usage-skeleton" key={item.value}>
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : !visible.length ? (
          <div className="usage-empty" role="status">
            <h3>此范围还没有用量记录。</h3>
            <p>任务完成后，引擎提供的用量会显示在这里。</p>
          </div>
        ) : (
          <>
            <Tabs.Panel value="overview">
              <UsageOverview
                visible={visible}
                names={names}
                days={days}
                groups={groups}
                metric={metric}
                setMetric={setMetric}
                explore={explore}
              />
            </Tabs.Panel>
            <Tabs.Panel value="explore">
              <div className="usage-query">
                <ChoicePicker
                  label="统计指标"
                  size="small"
                  value={metric}
                  onValueChange={(value) => setMetric(value as Metric)}
                  items={[...metrics]}
                />
                <span>按</span>
                <ChoicePicker
                  label="分组维度"
                  size="small"
                  value={dimension}
                  onValueChange={(value) => setDimension(value as Dimension)}
                  items={[...dimensions]}
                />
                <span>汇总 · 从高到低</span>
                <ChoicePicker
                  label="显示数量"
                  size="small"
                  value={limit}
                  onValueChange={setLimit}
                  items={[
                    { value: "5", label: "Top 5" },
                    { value: "10", label: "Top 10" },
                    { value: "20", label: "Top 20" },
                  ]}
                />
                <Button
                  variant="ghost"
                  size="small"
                  aria-pressed={expanded}
                  onClick={() => setExpanded(!expanded)}
                >
                  <ArrowsOutIcon />
                  {expanded ? "还原" : "展开图表"}
                </Button>
              </div>
              <UsageBreakdown groups={groups} metric={metric} />
            </Tabs.Panel>
            <Tabs.Panel value="details">
              <UsageDetails rows={visible} names={names} />
            </Tabs.Panel>
            <footer className="usage-footer">
              <span>
                {new Set(visible.map((row) => row.taskId)).size} 个任务 ·{" "}
                {visible.length} 条用量记录 · {elapsed}ms 读取
              </span>
              <span>
                {visible.filter((row) => row.costUsd === null).length}{" "}
                条成本未提供 ·{" "}
                {visible.filter((row) => row.costScope === "session").length}{" "}
                条会话累计
              </span>
            </footer>
          </>
        )}
      </Tabs.Root>
    </div>
  );
}
