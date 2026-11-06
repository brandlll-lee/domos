import { Loading } from "@domos/ui/loading";
import { useEffect, useState } from "react";

export default function CsvPreview({ blob }: { blob: Blob }) {
  const [state, setState] = useState<{
    rows: string[][];
    truncated: boolean;
    error?: string;
  }>();
  useEffect(() => {
    const worker = new Worker(new URL("./csv-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<NonNullable<typeof state>>) => {
      setState(event.data);
      worker.terminate();
    };
    worker.onerror = () => {
      setState({ rows: [], truncated: false, error: "CSV 读取失败。" });
      worker.terminate();
    };
    worker.postMessage(blob);
    return () => worker.terminate();
  }, [blob]);
  if (!state) return <Loading label="正在读取表格" />;
  return (
    <div className="file-document">
      {state.error && <p role="alert">{state.error}</p>}
      {state.truncated && <p>仅预览前 500 行、50 列。下载可查看完整内容。</p>}
      <div className="file-table">
        <table aria-label="CSV 内容">
          <tbody>
            {state.rows.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: CSV coordinates stay fixed within this file.
              <tr key={i}>
                {row.map((cell, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: CSV coordinates stay fixed within this file.
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
