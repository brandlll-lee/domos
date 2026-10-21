import type { EngineId } from "@domos/agent/harness/types";
import { useState } from "react";
import { EngineMark } from "../bots/engine-mark.tsx";
import {
  type Dimension,
  formatValue,
  harnesses,
  type Metric,
  metricUnit,
  money,
  recordTime,
  type UsageGroup,
  type UsageRecord,
} from "./data.ts";

const count = (value: number | null) =>
  value === null ? "未提供" : value.toLocaleString();
const harnessLabel = (id: string) =>
  harnesses.find((item) => item.value === id)?.label ?? id;

export function Breakdown({
  groups,
  metric,
  dimension,
}: {
  groups: UsageGroup[];
  metric: Metric;
  dimension: Dimension;
}) {
  const total = groups.reduce((sum, group) => sum + (group.value ?? 0), 0);
  const max = Math.max(...groups.map((group) => group.value ?? 0), 0);
  return (
    <ul className="usage-breakdown" aria-label="分组用量">
      {groups.map((group) => {
        const share =
          total && group.value !== null ? (group.value / total) * 100 : null;
        return (
          <li key={group.key}>
            <span className="usage-breakdown-label">
              {dimension === "harness" && group.key !== "other" ? (
                <EngineMark provider={group.key as EngineId} />
              ) : (
                <i className="usage-dot" style={{ background: group.color }} />
              )}
              <span className="usage-truncate">{group.label}</span>
            </span>
            <span className="usage-breakdown-value">
              {formatValue(group.value, metric)}
              <small>{share === null ? "—" : `${share.toFixed(1)}%`}</small>
            </span>
            <span className="usage-breakdown-track" aria-hidden="true">
              <span
                style={{
                  width: `${max && group.value !== null ? Math.max(2, (group.value / max) * 100) : 0}%`,
                  background: group.color,
                }}
              />
            </span>
          </li>
        );
      })}
      <li className="usage-breakdown-total">
        <span>合计</span>
        <span>
          {metric === "cost" ? money(total) : formatValue(total, metric)}
          <small>{metricUnit(metric)}</small>
        </span>
      </li>
    </ul>
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
      {matches.length ? (
        <div className="usage-table-scroll">
          <table className="usage-table usage-records" aria-label="用量明细">
            <thead>
              <tr>
                <th scope="col">时间 · UTC</th>
                <th scope="col">Bot</th>
                <th scope="col">Harness</th>
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
              </tr>
            </thead>
            <tbody>
              {matches.map((row) => (
                <tr
                  key={`${row.taskId}:${row.id}`}
                  title={`${row.taskId} · ${row.sessionId ?? "会话未提供"} · ${row.source}`}
                >
                  <td className="usage-time">{recordTime(row.timestamp)}</td>
                  <th scope="row">
                    <span className="usage-truncate">
                      {names.get(row.botId) ?? `Bot ${row.botId}`}
                    </span>
                  </th>
                  <td>
                    <span className="usage-harness">
                      <EngineMark provider={row.harness} />
                      <span>
                        {harnessLabel(row.harness)}
                        <small>{row.provider ?? "未提供"}</small>
                      </span>
                    </span>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="usage-muted" role="status">
          没有匹配的记录。
        </p>
      )}
    </>
  );
}
