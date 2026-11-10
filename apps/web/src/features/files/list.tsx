import type { ConversationFile } from "@domos/agent/files";
import { FileAttachment } from "@domos/ui/attachment";
import { Button } from "@domos/ui/controls";
import { SearchField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { useRef, useState } from "react";
import { useReadState } from "../read-state.ts";
import { useFilePreview } from "./context.tsx";
import { fileList } from "./file-state.ts";
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
  const store = fileList(botId, query);
  const read = useReadState(store.read);
  const previous = useRef({ botId, data: read.data });
  if (read.data || previous.current.botId !== botId)
    previous.current = { botId, data: read.data };
  const state = {
    items: read.data?.items ?? previous.current.data?.items ?? [],
    next: read.data?.next ?? null,
    loading: read.loading || (!read.data && !read.error),
    error: read.error ? "文件列表读取失败。" : "",
  };
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState("");
  return (
    <div className="file-list">
      <SearchField
        aria-label="搜索文件"
        placeholder="搜索文件名"
        value={query}
        onValueChange={(value) => {
          setQuery(value);
        }}
      />
      {state.error && (
        <p role="alert">
          {state.error}
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              void store.read.load(true).catch(() => {});
            }}
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
      {locateError && <p role="alert">{locateError}</p>}
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
              setLocateError("");
              void onShowMessage(item)
                .catch(() => setLocateError("无法定位原消息，请重试。"))
                .finally(() => setLocating(false));
            }}
          >
            在聊天中查看
          </Button>
        </div>
      ))}
      {state.loading && (
        <Loading label="正在读取文件" inline={state.items.length > 0} />
      )}
      {state.next !== null && !state.loading && (
        <Button variant="ghost" size="small" onClick={store.more}>
          加载更多
        </Button>
      )}
    </div>
  );
}
