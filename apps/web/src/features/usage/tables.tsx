import { EngineMark } from "@domos/ui/avatar";
import { SearchField } from "@domos/ui/field";
import { Pagination } from "@domos/ui/pagination";
import {
  compactNumber,
  type Dimension,
  harnesses,
  money,
  purposes,
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
  dimension,
  total,
  onSelect,
}: {
  groups: UsageGroup[];
  dimension: Dimension;
  total: number | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="usage-table-scroll">
      <table className="usage-table" aria-label="用量构成">
        <thead>
          <tr>
            <th scope="col">
              {dimension === "bot"
                ? "Bot"
                : dimension === "day"
                  ? "日期"
                  : dimension === "model"
                    ? "模型"
                    : "名称"}
            </th>
            <th scope="col">费用</th>
            <th scope="col">Token</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key}>
              <th scope="row">
                {group.key === "other" ||
                dimension === "skill" ||
                dimension === "purpose" ? (
                  group.label
                ) : (
                  <button
                    type="button"
                    className="usage-row-link"
                    title={group.label}
                    onClick={() => onSelect(group.key)}
                  >
                    {group.label}
                  </button>
                )}
              </th>
              <td
                title={
                  total && group.cost !== null
                    ? `占已知费用 ${((group.cost / total) * 100).toFixed(1)}%`
                    : undefined
                }
              >
                {money(group.cost)}
              </td>
              <td>
                {group.tokens === null ? "—" : compactNumber(group.tokens)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Records({
  rows,
  names,
  query,
  onQuery,
  page,
  total,
  onPage,
  loading,
}: {
  rows: UsageRecord[];
  names: Map<number, string>;
  query: string;
  onQuery: (query: string) => void;
  page: number;
  total: number;
  onPage: (page: number) => void;
  loading: boolean;
}) {
  return (
    <>
      <div className="usage-search">
        <SearchField
          aria-label="搜索用量记录"
          placeholder="搜索 Bot、模型或来源"
          spellCheck={false}
          maxLength={200}
          value={query}
          onValueChange={onQuery}
        />
        <span aria-live="polite">{total} 条</span>
      </div>
      {rows.length ? (
        <div className="usage-table-scroll">
          <table className="usage-table usage-records" aria-label="用量明细">
            <thead>
              <tr>
                <th scope="col">时间 · UTC</th>
                <th scope="col">Bot</th>
                <th scope="col">Harness</th>
                <th scope="col">模型</th>
                <th scope="col" className="usage-cell-value">
                  未缓存输入
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
                <th scope="col">记录依据</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
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
                    {money(row.costUsd, true)}
                    <small
                      title={[row.costSource ?? row.source, row.costVersion]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {row.costScope === "session"
                        ? "会话累计"
                        : row.costUsd === null
                          ? (row.pricingReason ?? "缺少原生金额或价格依据")
                          : row.costBasis === "estimated"
                            ? "价格估算"
                            : "引擎报告"}
                    </small>
                  </td>
                  <td>
                    <details className="usage-evidence">
                      <summary>
                        {purposes[row.purpose ?? ""] ?? "任务"} · 来源
                      </summary>
                      <dl>
                        <dt>任务</dt>
                        <dd>{row.taskId}</dd>
                        <dt>会话</dt>
                        <dd>{row.sessionId ?? "未返回"}</dd>
                        <dt>采集来源</dt>
                        <dd>{row.source}</dd>
                        <dt>计价依据</dt>
                        <dd>
                          {row.costSource ?? row.pricingReason ?? "未提供"}
                        </dd>
                        <dt>价格版本</dt>
                        <dd>{row.costVersion ?? "未提供"}</dd>
                        {row.nativeTokens ? (
                          <>
                            <dt>原生计数</dt>
                            <dd>{JSON.stringify(row.nativeTokens)}</dd>
                          </>
                        ) : null}
                      </dl>
                    </details>
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
      <Pagination
        label="用量翻页"
        page={page}
        pageSize={50}
        total={total}
        onPage={onPage}
        disabled={loading}
      />
    </>
  );
}
