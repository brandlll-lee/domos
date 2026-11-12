import type { Attachment } from "@domos/agent/attachments";
import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { useEffect, useState } from "react";
import { fileSummary } from "./file-state.ts";
import { useSpreadsheetPreview } from "./use-file.ts";
export default function XlsxPreview({
  botId,
  file,
}: {
  botId: number;
  file: Attachment;
}) {
  const [sheet, setSheet] = useState<string>();
  const state = useSpreadsheetPreview(botId, file, sheet);
  const data = state.data;
  useEffect(() => {
    if (data) {
      const store = fileSummary(botId, file);
      store.receive({ ...store.snapshot().data, sheets: data.sheets.length });
    }
  }, [botId, file, data]);
  if (!data && state.error)
    return (
      <p role="alert">
        {state.error instanceof Error
          ? state.error.message
          : "Excel 预览失败。"}
        <Button variant="ghost" size="small" onClick={state.retry}>
          重试
        </Button>
      </p>
    );
  if (!data) return <Loading label="正在读取 Excel" />;
  return (
    <div className="file-document">
      <div className="file-sheet-tabs">
        {data.sheets.map((name) => (
          <Button
            key={name}
            size="small"
            variant={name === data.sheet ? "secondary" : "ghost"}
            aria-pressed={name === data.sheet}
            onClick={() => setSheet(name)}
          >
            {name}
          </Button>
        ))}
      </div>
      <p>
        仅预览前 {data.rowLimit} 行、{data.columnLimit} 列。公式显示保存的结果。
      </p>
      {state.loading && <Loading label="正在读取工作表" inline />}
      <div className="file-table">
        <table aria-label="Excel 内容">
          <tbody>
            {data.rows.map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Worksheet row coordinates are stable within this preview.
              <tr key={r}>
                {row.map((cell, c) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Worksheet column coordinates are stable within this preview.
                  <td key={c}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
