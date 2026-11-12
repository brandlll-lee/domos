import type { FileCategory } from "@domos/agent/attachments";
import { filePreviewKind } from "@domos/agent/attachments";
import type { ConversationFile } from "@domos/agent/files";
import { FileAttachment } from "@domos/ui/attachment";
import { Button } from "@domos/ui/controls";
import { SearchField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { ActionMenu } from "@domos/ui/menu";
import { Tabs } from "@domos/ui/tabs";
import { PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
import { useRef, useState } from "react";
import { useReadState } from "../read-state.ts";
import { fileAction } from "./actions.ts";
import { useFilePreview } from "./context.tsx";
import { fileIcon } from "./file-icon.ts";
import { fileList } from "./file-state.ts";
import { useFileSummary } from "./use-file-summary.ts";
import "./style.css";

const categories = [
  { value: "all", label: "全部" },
  { value: "files", label: "文件" },
  { value: "media", label: "图片与视频" },
  { value: "audio", label: "音频" },
] as const;

export function FilesList({
  botId,
  onShowMessage,
}: {
  botId: number;
  onShowMessage: (item: ConversationFile) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FileCategory>("all");
  const store = fileList(botId, query, category);
  const read = useReadState(store.read);
  const previous = useRef({ botId, category, data: read.data });
  if (
    read.data ||
    previous.current.botId !== botId ||
    previous.current.category !== category
  )
    previous.current = { botId, category, data: read.data };
  const items = read.data?.items ?? previous.current.data?.items ?? [];
  const loading = read.loading || (!read.data && !read.error);
  return (
    <Tabs.Root
      className="file-list"
      value={category}
      onValueChange={(value) => setCategory(value as FileCategory)}
    >
      <SearchField
        aria-label="搜索文件"
        placeholder="搜索当前分类"
        value={query}
        onValueChange={setQuery}
      />
      <Tabs.List className="workspace-tabs" aria-label="文件分类">
        {categories.map((item) => (
          <Tabs.Tab
            className="navigation-tab"
            key={item.value}
            value={item.value}
          >
            {item.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <Tabs.Panel value={category} className="file-list-content">
        {Boolean(read.error) && (
          <p role="alert">
            文件列表读取失败。
            <Button
              variant="ghost"
              size="small"
              onClick={() => void store.read.load(true).catch(() => {})}
            >
              重试
            </Button>
          </p>
        )}
        {!loading && !read.error && !items.length && (
          <p className="file-empty">
            {query ? "当前分类没有匹配结果" : "此分类暂无附件"}
          </p>
        )}
        {items.map((item) => (
          <FileRow
            key={item.file.id}
            botId={botId}
            item={item}
            onShowMessage={onShowMessage}
          />
        ))}
        {loading && <Loading label="正在读取文件" inline={items.length > 0} />}
        {read.data?.next != null && !loading && (
          <Button variant="ghost" size="small" onClick={store.more}>
            加载更多
          </Button>
        )}
      </Tabs.Panel>
    </Tabs.Root>
  );
}

function FileRow({
  botId,
  item,
  onShowMessage,
}: {
  botId: number;
  item: ConversationFile;
  onShowMessage: (item: ConversationFile) => Promise<void>;
}) {
  const { file, timestamp } = item;
  const preview = useFilePreview();
  const { element, summary } = useFileSummary(botId, file);
  const Icon = fileIcon(file);
  const kind = filePreviewKind(file);
  const media = kind === "image" || kind === "video";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function act(action: "save" | "open" | "reveal" | "message") {
    setPending(true);
    setError(undefined);
    try {
      if (action === "message") await onShowMessage(item);
      else await fileAction(botId, file, action);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "文件操作未完成，请重试。",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div ref={element} className="file-list-row">
      <FileAttachment
        name={file.name}
        size={file.size}
        type={file.name.split(".").at(-1)?.toUpperCase()}
        icon={
          media ? (
            <span className="file-list-thumbnail">
              {summary?.thumbnail ? (
                <img src={summary.thumbnail} alt="" loading="lazy" />
              ) : (
                <Icon weight="duotone" />
              )}
              {kind === "video" && (
                <PlayIcon
                  className="file-list-play"
                  weight="fill"
                  aria-label="视频"
                />
              )}
            </span>
          ) : (
            <Icon weight="duotone" />
          )
        }
        onOpen={() => preview?.open(file, botId)}
        action={
          <div className="file-list-actions">
            {timestamp !== undefined && (
              <time
                dateTime={new Date(timestamp).toISOString()}
                title={new Date(timestamp).toLocaleString()}
              >
                {new Date(timestamp).toLocaleDateString(undefined, {
                  month: "numeric",
                  day: "numeric",
                })}
              </time>
            )}
            <ActionMenu
              label={`更多文件操作 ${file.name}`}
              disabled={pending}
              items={[
                { label: "另存为…", onSelect: () => void act("save") },
                ...(window.domosDesktop
                  ? [
                      {
                        label: "系统打开本地副本",
                        onSelect: () => void act("open"),
                      },
                      {
                        label: "显示本地副本位置",
                        onSelect: () => void act("reveal"),
                      },
                    ]
                  : []),
                { label: "在聊天中查看", onSelect: () => void act("message") },
              ]}
            />
          </div>
        }
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
