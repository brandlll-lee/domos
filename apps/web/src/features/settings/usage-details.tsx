import { harnesses, money, type UsageRecord } from "./usage-data.ts";

const count = (value: number | null) =>
  value === null ? "未提供" : value.toLocaleString();
export function UsageDetails({
  rows,
  names,
}: {
  rows: UsageRecord[];
  names: Map<number, string>;
}) {
  return (
    <div className="usage-table-scroll">
      <table className="usage-table usage-records" aria-label="用量明细">
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
          {rows.map((row) => (
            <tr key={`${row.taskId}:${row.id}`}>
              <th scope="row">
                <span title={names.get(row.botId) ?? `Bot ${row.botId}`}>
                  {names.get(row.botId) ?? `Bot ${row.botId}`}
                </span>
                <details>
                  <summary>任务详情</summary>
                  <span>{row.taskId}</span>
                  <span>{row.sessionId ?? "会话未提供"}</span>
                  <time dateTime={new Date(row.timestamp).toISOString()}>
                    {new Date(row.timestamp).toISOString()}
                  </time>
                </details>
              </th>
              <td>
                {harnesses.find((item) => item.value === row.harness)?.label}
                <small>{row.provider ?? "未提供"}</small>
              </td>
              <td title={row.model ?? "未提供"}>{row.model ?? "未提供"}</td>
              <td>{count(row.input)}</td>
              <td>{count(row.output)}</td>
              <td>
                {count(row.cacheRead)} / {count(row.cacheWrite)}
              </td>
              <td>
                {money(row.costUsd)}
                {row.costScope === "session" && <small>会话累计</small>}
              </td>
              <td title={row.source}>{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
