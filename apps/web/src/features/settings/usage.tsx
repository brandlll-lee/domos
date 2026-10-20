import { Button } from "@domos/ui/controls";
import { ChoicePicker } from "@domos/ui/picker";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { userError } from "../user-error.ts";
import { type UsagePeriod, usagePeriodRange } from "./usage-period.ts";
import "./usage.css";

type UsageRecord = Awaited<ReturnType<typeof client.engines.usage>>[number];

const harnesses = [
  { value: "pi", label: "Pi" },
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
];
const count = (value: number | null) =>
  value === null ? "未提供" : value.toLocaleString();
const money = (value: number | null) =>
  value === null ? "未提供" : `$${value.toFixed(4)}`;

export function UsageSettings() {
  const [query, setQuery] = useState({ period: "month" as UsagePeriod });
  const period = query.period;
  const [harness, setHarness] = useState("");
  const [provider, setProvider] = useState("");
  const [botId, setBotId] = useState("");
  const [model, setModel] = useState("");
  const [rows, setRows] = useState<UsageRecord[]>([]);
  const [bots, setBots] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    const range = usagePeriodRange(query.period);
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
  }, [query]);
  const visible = rows.filter(
    (row) =>
      (!harness || row.harness === harness) &&
      (!provider || row.provider === provider) &&
      (!model || row.model === model) &&
      (!botId || String(row.botId) === botId),
  );
  const names = new Map(bots.map((bot) => [bot.id, bot.name]));
  const choices = (values: (string | null)[]) => [
    { value: "", label: "全部" },
    ...[...new Set(values.filter((value): value is string => value !== null))]
      .sort()
      .map((value) => ({ value, label: value })),
  ];
  return (
    <div className="settings-sections" aria-busy={loading}>
      <section className="settings-group">
        <h3>用量与成本</h3>
        <div className="usage-filters">
          <ChoicePicker
            label="日期范围"
            size="small"
            value={period}
            onValueChange={(value) =>
              setQuery({ period: value as UsagePeriod })
            }
            items={[
              { value: "month", label: "本月" },
              { value: "lastMonth", label: "上月" },
              { value: "days30", label: "近 30 天" },
            ]}
          />
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
              ...bots.map((bot) => ({
                value: String(bot.id),
                label: bot.name,
              })),
            ]}
          />
          <ChoicePicker
            label="用量模型"
            size="small"
            value={model}
            onValueChange={setModel}
            items={choices(rows.map((row) => row.model))}
          />
          <Button
            size="small"
            variant="secondary"
            disabled={loading}
            onClick={() => setQuery({ period })}
          >
            刷新用量
          </Button>
        </div>
        <p className="detail-note">
          仅显示引擎返回的数据。日期按 UTC 计算。成本单位为
          USD。输入和缓存保留原生口径。
        </p>
        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : loading ? (
          <p role="status">正在读取用量…</p>
        ) : !visible.length ? (
          <p className="detail-note">此范围还没有用量记录。</p>
        ) : (
          <>
            <p className="detail-note">
              {new Set(visible.map((row) => row.taskId)).size} 个任务 ·{" "}
              {visible.length} 条用量记录 ·{" "}
              {visible.filter((row) => row.costUsd === null).length}{" "}
              条成本未提供
            </p>
            <div className="usage-table-scroll">
              <table className="usage-table" aria-label="用量明细">
                <thead>
                  <tr>
                    {[
                      "Bot / 任务",
                      "Harness / Provider",
                      "模型",
                      "输入",
                      "输出",
                      "缓存读 / 写",
                      "报告成本",
                      "来源",
                    ].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={`${row.taskId}:${row.id}`}>
                      <th scope="row">
                        <span>
                          {names.get(row.botId) ?? `Bot ${row.botId}`}
                        </span>
                        <details>
                          <summary>任务详情</summary>
                          <span>{row.taskId}</span>
                          <span>{row.sessionId ?? "会话未提供"}</span>
                          <time
                            dateTime={new Date(row.timestamp).toISOString()}
                          >
                            {new Date(row.timestamp).toLocaleString()}
                          </time>
                        </details>
                      </th>
                      <td>
                        {
                          harnesses.find((item) => item.value === row.harness)
                            ?.label
                        }
                        <small>{row.provider ?? "未提供"}</small>
                      </td>
                      <td>{row.model ?? "未提供"}</td>
                      <td>{count(row.input)}</td>
                      <td>{count(row.output)}</td>
                      <td>
                        {count(row.cacheRead)} / {count(row.cacheWrite)}
                      </td>
                      <td>
                        {money(row.costUsd)}
                        {row.costScope === "session" && <small>会话累计</small>}
                      </td>
                      <td>{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visible.some((row) => row.costScope === "session") && (
              <p className="detail-note">
                会话累计成本包含该会话此前的调用。各行保留对应时刻的原生快照。
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
