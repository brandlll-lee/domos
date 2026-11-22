import {
  MEMORY_CONTEXT_BYTES,
  MEMORY_PROFILE_BYTES,
  WORK_TEXT_LENGTH,
} from "@domos/agent/work/limits";
import { SegmentedControl } from "@domos/ui/choice";
import { Button } from "@domos/ui/controls";
import { ConfirmDialog, Dialog, DialogFooter } from "@domos/ui/dialog";
import { Checkbox, SearchField, TextField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { InlineNotice } from "@domos/ui/message";
import { PanelCard, PanelRow } from "@domos/ui/panel";
import { Popover } from "@domos/ui/popover";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
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
  | { kind: "edit"; entry: Entry | null }
  | { kind: "candidates" }
  | { kind: "candidate"; id: string };
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
  candidates,
  reviewEnabled,
  usage,
  action,
  onEvidence,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botId: number;
  items: Entry[];
  candidates: WorkData["memoryCandidates"];
  reviewEnabled: boolean;
  usage: WorkData["memoryUsage"];
  action: WorkAction;
  onEvidence: (
    value: Awaited<ReturnType<typeof client.work.memory.evidence>>,
  ) => Promise<void>;
}) {
  const [view, setView] = useState<View | null>(null);
  const [chosenCategory, setCategory] = useState<Category | null>(null);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLSpanElement>(null);
  const position = useRef({ top: 0, id: "" });
  const category =
    chosenCategory ??
    (items.length === 0 || items.some((item) => item.category === "profile")
      ? "profile"
      : "work");
  const current =
    view?.kind === "read"
      ? items.find((item) => item.id === view.id)
      : undefined;
  const candidate =
    view?.kind === "candidate"
      ? candidates.find((item) => item.id === view.id)
      : undefined;
  const previous = candidate
    ? items.find(
        (item) =>
          item.id === (candidate.input.replaces?.id ?? candidate.input.id),
      )
    : undefined;
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = items.filter(
    (item) =>
      (item.category ?? "work") === category &&
      words.every((word) => item.text.toLocaleLowerCase().includes(word)),
  );

  useLayoutEffect(() => {
    if (!open) return;
    if (viewport.current)
      viewport.current.scrollTop = view ? 0 : position.current.top;
    if (view && view.kind !== "edit")
      heading.current?.focus({ preventScroll: true });
    else if (!view && position.current.id)
      document
        .getElementById(position.current.id)
        ?.focus({ preventScroll: true });
  }, [view, open]);

  function navigate(next: View, id = "") {
    if (!view) position.current = { top: viewport.current?.scrollTop ?? 0, id };
    action.clear();
    setView(next);
  }
  function back() {
    action.clear();
    setView(
      view?.kind === "candidate"
        ? { kind: "candidates" }
        : view?.kind === "edit" && view.entry
          ? { kind: "read", id: view.entry.id }
          : null,
    );
  }
  function resolve(id: string, accept: boolean) {
    void action.run(
      ["memory.resolve", id, accept],
      () => client.work.memory.resolve({ botId, id, accept }),
      () => {
        refreshBotWork();
        setView({ kind: "candidates" });
      },
    );
  }
  const title =
    view?.kind === "edit"
      ? view.entry
        ? "编辑记忆"
        : "新增记忆"
      : view?.kind === "candidate"
        ? "确认记忆"
        : view?.kind === "candidates"
          ? "待确认"
          : "记忆";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setView(null);
          action.clear();
        }
        onOpenChange(next);
      }}
      className="memory-dialog"
      viewportRef={viewport}
      initialFocus={() => search.current ?? heading.current}
      title={
        <span className="memory-title" ref={heading} tabIndex={-1}>
          {view && (
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="返回"
              disabled={action.busy}
              onClick={back}
            >
              <ArrowLeftIcon />
            </Button>
          )}
          {title}
        </span>
      }
      headerActions={
        !view ? (
          <>
            <Button
              size="small"
              onClick={() => navigate({ kind: "edit", entry: null })}
              disabled={action.busy}
              aria-label="新增记忆"
            >
              <PlusIcon />
              新增
            </Button>
            <Popover.Root>
              <Popover.Trigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-small"
                    aria-label="记忆信息"
                  />
                }
              >
                <InfoIcon />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner
                  className="popover-positioner"
                  side="bottom"
                  align="end"
                  sideOffset={8}
                  collisionPadding={12}
                >
                  <Popover.Popup className="popover-surface memory-info">
                    <Popover.Title>记忆容量</Popover.Title>
                    {categories.map(({ value, label }) => (
                      <p key={value}>
                        {label}
                        <span>
                          {(usage[value] / 1024).toFixed(1)} /{" "}
                          {limits[value] / 1024} KiB
                        </span>
                      </p>
                    ))}
                    <Popover.Description>
                      用户档案进入每轮上下文，工作笔记按需检索。
                    </Popover.Description>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
            <ActionMenu
              label="记忆设置"
              disabled={action.busy}
              items={[
                {
                  label: reviewEnabled ? "关闭后台回顾" : "开启后台回顾",
                  onSelect: () =>
                    void action.run(["memory.review", !reviewEnabled], () =>
                      client.work.memory.review.setEnabled({
                        botId,
                        enabled: !reviewEnabled,
                      }),
                    ),
                },
              ]}
            />
          </>
        ) : current ? (
          <>
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
          </>
        ) : undefined
      }
      subheader={
        !view && (
          <div className="memory-toolbar">
            <SegmentedControl
              label="记忆类别"
              value={category}
              onValueChange={(value) => {
                setCategory(value);
                position.current = { top: 0, id: "" };
                if (viewport.current) viewport.current.scrollTop = 0;
              }}
              options={categories}
            />
            <SearchField
              inputRef={search}
              value={query}
              onValueChange={setQuery}
              aria-label="搜索记忆"
              placeholder="搜索记忆"
            />
            {candidates.length > 0 && (
              <Button
                variant="secondary"
                size="small"
                id="memory-candidates"
                onClick={() =>
                  navigate({ kind: "candidates" }, "memory-candidates")
                }
              >
                待确认 · {candidates.length}
              </Button>
            )}
          </div>
        )
      }
    >
      {action.error && (
        <p role="alert" className="alert">
          {action.error}
        </p>
      )}
      {!view && (
        <section className="memory-page" aria-label="记忆列表">
          {usage[category] >= limits[category] * 0.9 && (
            <InlineNotice>
              {categories.find((item) => item.value === category)?.label}
              容量接近上限
            </InlineNotice>
          )}
          {matches.length ? (
            <PanelCard>
              <ul className="memory-list">
                {matches.map((entry) => (
                  <li key={entry.id}>
                    <PanelRow
                      id={`memory-${entry.id}`}
                      title={entry.text}
                      preview
                      value={entry.botId === null ? "共享" : undefined}
                      onClick={() =>
                        navigate(
                          { kind: "read", id: entry.id },
                          `memory-${entry.id}`,
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            </PanelCard>
          ) : (
            <p className="detail-empty">
              {query.trim()
                ? "未找到匹配的记忆"
                : `暂无${category === "profile" ? "用户档案" : "工作笔记"}`}
            </p>
          )}
        </section>
      )}
      {view?.kind === "read" &&
        (current ? (
          <article className="memory-reading" aria-label="记忆正文">
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
              {current.effectiveAt && (
                <time dateTime={current.effectiveAt}>
                  {new Date(current.effectiveAt).toLocaleDateString()} 起生效
                </time>
              )}
            </div>
            {current.evidence?.length ? (
              <nav className="memory-evidence" aria-label="原始出处">
                {current.evidence.map((ref, index) => (
                  <Button
                    key={`${ref.entryId}:${ref.quote}`}
                    variant="secondary"
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
                    {(current.evidence?.length ?? 0) > 1 ? ` ${index + 1}` : ""}
                  </Button>
                ))}
              </nav>
            ) : null}
          </article>
        ) : (
          <InlineNotice>这条记忆已移除</InlineNotice>
        ))}
      {view?.kind === "candidates" && (
        <section className="memory-page" aria-label="待确认记忆">
          {candidates.length ? (
            <PanelCard>
              <ul>
                {candidates.map((item) => (
                  <li key={item.id}>
                    <PanelRow
                      title={item.input.text}
                      preview
                      value={
                        item.input.replaces || item.input.revision > 0
                          ? "修改"
                          : "新增"
                      }
                      onClick={() =>
                        navigate({ kind: "candidate", id: item.id })
                      }
                    />
                  </li>
                ))}
              </ul>
            </PanelCard>
          ) : (
            <p className="detail-empty">没有待确认的记忆</p>
          )}
        </section>
      )}
      {candidate && (
        <section className="memory-page" aria-label="记忆修改对照">
          <div className="memory-comparison">
            <section aria-label="修改前">
              <h3>修改前</h3>
              <PanelCard>
                <p className="memory-text">
                  {previous?.text ??
                    (candidate.input.replaces || candidate.input.revision > 0
                      ? "原记忆已移除"
                      : "新增记忆")}
                </p>
              </PanelCard>
            </section>
            <section aria-label="修改后">
              <h3>修改后</h3>
              <PanelCard>
                <p className="memory-text">{candidate.input.text}</p>
              </PanelCard>
            </section>
          </div>
          <DialogFooter>
            <div className="dialog-actions">
              <Button
                variant="ghost"
                size="small"
                disabled={action.busy}
                onClick={() => resolve(candidate.id, false)}
              >
                忽略
              </Button>
              <Button
                size="small"
                pending={action.busy}
                onClick={() => resolve(candidate.id, true)}
              >
                保存记忆
              </Button>
            </div>
          </DialogFooter>
        </section>
      )}
      {view?.kind === "candidate" && !candidate && (
        <InlineNotice>这项修改已处理</InlineNotice>
      )}
      {view?.kind === "edit" && (
        <MemoryEditor
          key={view.entry?.id ?? "new"}
          botId={botId}
          entry={view.entry}
          category={category}
          action={action}
          onDone={(savedCategory) => {
            action.clear();
            if (savedCategory) setCategory(savedCategory);
            setView(view.entry ? { kind: "read", id: view.entry.id } : null);
          }}
        />
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
      className="memory-editor"
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
