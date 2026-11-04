import type { ConversationFile } from "@domos/agent/files";
import { FileAttachment } from "@domos/ui/attachment";
import { Button } from "@domos/ui/controls";
import { SearchField } from "@domos/ui/field";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { useFilePreview } from "./context.tsx";
import "./style.css";

export function FilesList({
  botId,
  onShowMessage,
}: {
  botId: number;
  onShowMessage: (item: ConversationFile) => Promise<void>;
}) {
  const preview = useFilePreview();
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    items: ConversationFile[];
    next: number | null;
    loading: boolean;
    error: string;
  }>({ items: [], next: null, loading: true, error: "" });
  const [locating, setLocating] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry starts a fresh query.
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({
      ...previous,
      items: offset === 0 ? [] : previous.items,
      loading: true,
      error: "",
    }));
    void client.files
      .list({ botId, query, offset }, { signal: controller.signal })
      .then((page) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            items: offset ? [...previous.items, ...page.items] : page.items,
            next: page.next,
            loading: false,
            error: "",
          }));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            ...previous,
            loading: false,
            error: "文件列表读取失败。",
          }));
      });
    return () => controller.abort();
  }, [botId, query, offset, retry]);
  return (
    <div className="file-list">
      <SearchField
        aria-label="搜索文件"
        placeholder="搜索文件名"
        value={query}
        onValueChange={(value) => {
          setQuery(value);
          setOffset(0);
        }}
      />
      {state.error && (
        <p role="alert">
          {state.error}
          <Button
            variant="ghost"
            size="small"
            onClick={() => setRetry((v) => v + 1)}
          >
            重试
          </Button>
        </p>
      )}
      {!state.loading && !state.error && !state.items.length && (
        <p className="file-empty">
          {query ? "没有找到文件" : "发送和收到的文件会显示在这里"}
        </p>
      )}
      {state.items.map((item) => (
        <div className="file-list-row" key={item.file.id}>
          <button
            type="button"
            className="file-open"
            onClick={() => preview?.open(item.file)}
            aria-label={`预览 ${item.file.name}`}
          >
            <FileAttachment
              name={item.file.name}
              size={item.file.size}
              action={null}
            />
          </button>
          <Button
            variant="ghost"
            size="small"
            pending={locating}
            onClick={() => {
              setLocating(true);
              void onShowMessage(item)
                .catch(() =>
                  setState((state) => ({
                    ...state,
                    error: "无法定位原消息，请重试。",
                  })),
                )
                .finally(() => setLocating(false));
            }}
          >
            在聊天中查看
          </Button>
        </div>
      ))}
      {state.loading && <p role="status">正在读取文件…</p>}
      {state.next !== null && !state.loading && (
        <Button
          variant="ghost"
          size="small"
          onClick={() => {
            if (state.next !== null) setOffset(state.next);
          }}
        >
          加载更多
        </Button>
      )}
    </div>
  );
}
