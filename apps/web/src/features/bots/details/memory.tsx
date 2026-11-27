import {
  MEMORY_CONTEXT_BYTES,
  MEMORY_PROFILE_BYTES,
  WORK_TEXT_LENGTH,
} from "@domos/agent/work/limits";
import { SegmentedControl } from "@domos/ui/choice";
import { Button, Switch } from "@domos/ui/controls";
import { ConfirmDialog, Dialog, DialogFooter } from "@domos/ui/dialog";
import { Checkbox, SearchField, TextField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { InlineNotice } from "@domos/ui/message";
import { ScrollArea } from "@domos/ui/scroll-area";
import { SettingRow } from "@domos/ui/setting-row";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useLayoutEffect, useRef, useState } from "react";
import { client } from "../../../client.ts";
import {
  refreshBotWork,
  type WorkAction,
  type WorkData,
} from "./use-bot-work.ts";
import "./memory.css";

type Entry = WorkData["memory"][number];
type Category = "profile" | "work";
type View =
  | { kind: "read"; id: string }
  | { kind: "edit"; entry: Entry | null };
const categories = [
  { value: "profile", label: "用户档案" },
  { value: "work", label: "工作笔记" },
] as const;
const limits = {
  profile: MEMORY_PROFILE_BYTES,
  work: MEMORY_CONTEXT_BYTES - MEMORY_PROFILE_BYTES,
};

export function MemoryDialog({
  open,
  onOpenChange,
  botId,
  items,
  reviewEnabled,
  usage,
  action,
  onEvidence,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botId: number;
  items: Entry[];
  reviewEnabled: boolean;
  usage: WorkData["memoryUsage"];
  action: WorkAction;
  onEvidence: (
    value: Awaited<ReturnType<typeof client.work.memory.evidence>>,
  ) => Promise<void>;
}) {
  const [view, setView] = useState<View | null>(null);
  const [settings, setSettings] = useState(false);
  const [chosenCategory, setCategory] = useState<Category | null>(null);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const position = useRef({ top: 0, id: "" });
  const category =
    chosenCategory ??
    (items.length === 0 || items.some((item) => item.category === "profile")
      ? "profile"
      : "work");
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = items.filter(
    (item) =>
      (item.category ?? "work") === category &&
      words.every((word) => item.text.toLocaleLowerCase().includes(word)),
  );
  const current =
    view?.kind === "read"
      ? items.find((item) => item.id === view.id)
      : matches[0];
  const editing = view?.kind === "edit";
  useLayoutEffect(() => {
    if (!open || view || settings) return;
    if (viewport.current) viewport.current.scrollTop = position.current.top;
    if (position.current.id)
      document
        .getElementById(position.current.id)
        ?.focus({ preventScroll: true });
  }, [view, open, settings]);
  function navigate(next: View, id = "") {
    if (!view) position.current = { top: viewport.current?.scrollTop ?? 0, id };
    action.clear();
    setView(next);
  }
  function back() {
    action.clear();
    setSettings(false);
    setView(
      view?.kind === "edit" && view.entry
        ? { kind: "read", id: view.entry.id }
        : null,
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!action.busy) onOpenChange(next);
      }}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setView(null);
          setSettings(false);
          action.clear();
        }
      }}
      className="memory-dialog"
      layout={editing || settings ? "task" : "window"}
      initialFocus={editing || settings ? undefined : () => search.current}
      title={
        editing
          ? view.entry
            ? "编辑记忆"
            : "添加记忆"
          : settings
            ? "记忆设置"
            : "记忆"
      }
      onBack={view || settings ? back : undefined}
      backDisabled={action.busy}
      headerActions={
        !editing && !settings ? (
          <>
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="记忆设置"
              title="记忆设置"
              onClick={() => setSettings(true)}
            >
              <GearSixIcon />
            </Button>
            <Button
              size="small"
              disabled={action.busy}
              onClick={() => navigate({ kind: "edit", entry: null })}
            >
              <PlusIcon />
              添加记忆
            </Button>
          </>
        ) : undefined
      }
      subheader={
        !editing && !settings ? (
          <div className="memory-toolbar">
            <SegmentedControl
              label="记忆类别"
              value={category}
              options={categories}
              onValueChange={(value) => {
                setCategory(value);
                setView(null);
                position.current = { top: 0, id: "" };
              }}
            />
            <SearchField
              inputRef={search}
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                setView(null);
              }}
              aria-label="搜索记忆"
              placeholder="搜索记忆"
            />
          </div>
        ) : undefined
      }
    >
      {action.error && (
        <p role="alert" className="alert">
          {action.error}
        </p>
      )}
      {editing ? (
        <MemoryEditor
          key={view.entry?.id ?? "new"}
          botId={botId}
          entry={view.entry}
          category={category}
          action={action}
          onDone={(savedCategory) => {
            action.clear();
            if (savedCategory) {
              setCategory(savedCategory);
              setQuery("");
            }
            setView(view.entry ? { kind: "read", id: view.entry.id } : null);
          }}
        />
      ) : settings ? (
        <div className="form-fields">
          <SettingRow
            title="后台回顾"
            description="定期从对话中整理有依据的记忆。"
          >
            <Switch
              label="后台回顾"
              checked={reviewEnabled}
              disabled={action.busy}
              onCheckedChange={(enabled) =>
                void action.run(
                  ["memory.review", enabled],
                  () =>
                    client.work.memory.review.setEnabled({ botId, enabled }),
                  refreshBotWork,
                )
              }
            />
          </SettingRow>
          <p className="detail-note">
            用户档案会进入每轮对话；工作笔记在需要时查找。
          </p>
          {categories.map(({ value, label }) => (
            <SettingRow key={value} title={`${label}容量`}>
              <span>
                {(usage[value] / 1024).toFixed(1)} / {limits[value] / 1024} KiB
              </span>
            </SettingRow>
          ))}
        </div>
      ) : (
        <div className="memory-layout" data-detail={view?.kind === "read"}>
          <section className="memory-index" aria-label="记忆列表">
            <ScrollArea viewportRef={viewport} className="memory-index-scroll">
              {usage[category] >= limits[category] * 0.9 && (
                <InlineNotice>容量接近上限</InlineNotice>
              )}
              {matches.length ? (
                <ul className="memory-list">
                  {matches.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        id={`memory-${entry.id}`}
                        className="memory-entry"
                        aria-label={entry.text}
                        aria-pressed={current?.id === entry.id}
                        onClick={() =>
                          navigate(
                            { kind: "read", id: entry.id },
                            `memory-${entry.id}`,
                          )
                        }
                      >
                        <span>{entry.text}</span>
                        <small>
                          {new Date(entry.updatedAt).toLocaleDateString(
                            "zh-CN",
                            { month: "long", day: "numeric" },
                          )}
                          更新{entry.botId === null ? " · 已共享" : ""}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="detail-empty">
                  {query.trim()
                    ? "未找到匹配的记忆"
                    : `暂无${category === "profile" ? "用户档案" : "工作笔记"}`}
                </p>
              )}
            </ScrollArea>
          </section>
          {current ? (
            <ScrollArea className="memory-reading-scroll">
              <article className="memory-reading" aria-label="记忆正文">
                <div className="memory-reading-actions">
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={action.busy}
                    onClick={() => navigate({ kind: "edit", entry: current })}
                  >
                    编辑
                  </Button>
                  <ActionMenu
                    label="记忆操作"
                    disabled={action.busy}
                    items={[
                      {
                        label: "删除",
                        tone: "danger",
                        onSelect: () => setDeleting(current),
                      },
                    ]}
                  />
                </div>
                <p className="memory-text">{current.text}</p>
                <div className="memory-metadata">
                  <span>
                    {current.origin === "user"
                      ? "用户原话"
                      : current.origin === "tool"
                        ? "工具观察"
                        : current.origin === "inference"
                          ? "模型推断"
                          : current.source.startsWith("bot:")
                            ? "Bot 记录"
                            : "你添加"}
                  </span>
                  {current.botId === null && <span>共享给所有 Bot</span>}
                  <time dateTime={new Date(current.updatedAt).toISOString()}>
                    {new Date(current.updatedAt).toLocaleString()} 更新
                  </time>
                </div>
                {current.evidence?.length ? (
                  <nav className="memory-evidence" aria-label="原始出处">
                    {current.evidence.map((ref, index) => (
                      <Button
                        key={`${ref.entryId}:${ref.quote}`}
                        variant="ghost"
                        size="small"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(
                            ["memory.evidence", current.id, index],
                            async () => {
                              const value = await client.work.memory.evidence({
                                botId,
                                id: current.id,
                                index,
                              });
                              await onEvidence(value);
                              onOpenChange(false);
                              setView(null);
                            },
                          )
                        }
                      >
                        查看出处
                        {(current.evidence?.length ?? 0) > 1
                          ? ` ${index + 1}`
                          : ""}
                      </Button>
                    ))}
                  </nav>
                ) : current.source.startsWith("bot:") ? (
                  <span className="memory-metadata">未记录原始出处</span>
                ) : null}
              </article>
            </ScrollArea>
          ) : (
            <div />
          )}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="删除这条记忆？"
        description="从保存的记忆中删除。原始聊天和当前模型上下文仍会保留。"
        onConfirm={() => {
          const entry = deleting;
          setDeleting(null);
          if (entry)
            void action.run(
              ["memory.delete", entry.id, entry.revision],
              () =>
                client.work.memory.delete({
                  botId,
                  id: entry.id,
                  revision: entry.revision,
                }),
              () => {
                refreshBotWork();
                setView(null);
              },
            );
        }}
      />
    </Dialog>
  );
}
function MemoryEditor({
  botId,
  entry,
  category: initialCategory,
  action,
  onDone,
}: {
  botId: number;
  entry: Entry | null;
  category: Category;
  action: WorkAction;
  onDone: (category?: Category) => void;
}) {
  const [id] = useState(() => entry?.id ?? crypto.randomUUID());
  const [text, setText] = useState(entry?.text ?? "");
  const [category, setCategory] = useState<Category>(
    entry ? (entry.category ?? "work") : initialCategory,
  );
  const [shared, setShared] = useState(entry?.botId === null);
  const input = {
    botId,
    id,
    revision: entry?.revision ?? 0,
    text,
    category,
    shared,
  };
  return (
    <form
      id="memory-editor"
      className="memory-editor form-fields"
      aria-busy={action.busy}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(
          ["memory.save", input],
          (requestId) => client.work.memory.save({ ...input, requestId }),
          () => {
            refreshBotWork();
            onDone(category);
          },
        );
      }}
    >
      <TextField
        label="内容"
        labelClassName="sr-only"
        placeholder="写下希望 Bot 记住的内容…"
        value={text}
        onValueChange={setText}
        multiline
        required
        autoFocus
        disabled={action.busy}
        maxLength={WORK_TEXT_LENGTH}
      />
      <div className="memory-editor-options">
        <SegmentedControl
          label="记忆类别"
          value={category}
          onValueChange={setCategory}
          options={categories}
          disabled={action.busy}
        />
        <Checkbox
          label="共享给所有 Bot"
          checked={shared}
          onCheckedChange={setShared}
          disabled={action.busy}
        />
      </div>
      <DialogFooter>
        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            size="small"
            onClick={() => onDone()}
            disabled={action.busy}
          >
            取消
          </Button>
          <Button
            type="submit"
            form="memory-editor"
            size="small"
            pending={action.busy}
            disabled={!text.trim()}
          >
            保存
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
