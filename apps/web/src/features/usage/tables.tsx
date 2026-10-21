import { useState } from "react";
import { ShareMeter } from "./charts.tsx";
import {
  formatValue,
  harnesses,
  type Metric,
  metricLabel,
  metricUnit,
  money,
  recordTime,
  type UsageGroup,
  type UsageRecord,
} from "./data.ts";

const count = (value: number | null) =>
  value === null ? "未提供" : value.toLocaleString();

export function Breakdown({
  groups,
  metric,
}: {
  groups: UsageGroup[];
  metric: Metric;
}) {
  const total = groups.reduce((sum, group) => sum + (group.value ?? 0), 0);
  return (
    <div className="usage-table-scroll">
      <table className="usage-table" aria-label="分组用量">
        <thead>
          <tr>
            <th scope="col">名称</th>
            <th scope="col" className="usage-cell-value">
              {metricLabel(metric)} · {metricUnit(metric)}
            </th>
            <th scope="col">占比</th>
            <th scope="col" className="usage-cell-count">
              记录
            </th>
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
                  <span className="usage-truncate">{group.label}</span>
                </th>
                <td className="usage-cell-value">
                  {formatValue(group.value, metric)}
                </td>
                <td>
                  <ShareMeter share={share} color={group.color} />
                </td>
                <td className="usage-cell-count">{group.rows.length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Records({
  rows,
  names,
}: {
  rows: UsageRecord[];
  names: Map<number, string>;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? rows.filter((row) =>
        [
          names.get(row.botId) ?? `Bot ${row.botId}`,
          row.harness,
          row.provider ?? "",
          row.model ?? "",
          row.source,
          row.taskId,
        ]
          .join("\n")
          .toLocaleLowerCase()
          .includes(needle),
      )
    : rows;
  return (
    <>
      <label className="usage-search">
        <input
          type="search"
          aria-label="搜索用量记录"
          placeholder="搜索 Bot、模型或来源"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span aria-live="polite">
          {needle ? `${matches.length} / ${rows.length}` : `${rows.length} 条`}
        </span>
      </label>
      <div className="usage-table-scroll">
        <table className="usage-table usage-records" aria-label="用量明细">
          <thead>
            <tr>
              <th scope="col">时间 · UTC</th>
              <th scope="col">Bot</th>
              <th scope="col">Harness · Provider</th>
              <th scope="col">模型</th>
              <th scope="col" className="usage-cell-value">
                输入
              </th>
              <th scope="col" className="usage-cell-value">
                输出
              </th>
              <th scope="col" className="usage-cell-value">
                缓存读 / 写
              </th>
              <th scope="col" className="usage-cell-value">
                成本
              </th>
              <th scope="col">来源</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((row) => (
              <tr
                key={`${row.taskId}:${row.id}`}
                title={`${row.taskId} · ${row.sessionId ?? "会话未提供"}`}
              >
                <td className="usage-time">{recordTime(row.timestamp)}</td>
                <th scope="row">
                  <span className="usage-truncate">
                    {names.get(row.botId) ?? `Bot ${row.botId}`}
                  </span>
                </th>
                <td>
                  <span className="usage-truncate">
                    {harnesses.find((item) => item.value === row.harness)
                      ?.label ?? row.harness}
                  </span>
                  <small>{row.provider ?? "未提供"}</small>
                </td>
                <td title={row.model ?? "未提供"}>
                  <span className="usage-truncate usage-mono">
                    {row.model ?? "未提供"}
                  </span>
                </td>
                <td className="usage-cell-value">{count(row.input)}</td>
                <td className="usage-cell-value">{count(row.output)}</td>
                <td className="usage-cell-value">
                  {count(row.cacheRead)} / {count(row.cacheWrite)}
                </td>
                <td className="usage-cell-value">
                  {money(row.costUsd)}
                  {row.costScope === "session" && <small>会话累计</small>}
                </td>
                <td>
                  <span className="usage-truncate usage-mono">
                    {row.source}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!matches.length && (
        <p className="usage-muted" role="status">
          没有匹配的记录。
        </p>
      )}
    </>
  );
}
