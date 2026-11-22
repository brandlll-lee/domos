import { WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { SegmentedControl } from "@domos/ui/choice";
import { Button } from "@domos/ui/controls";
import { ConfirmDialog, Dialog, DialogFooter } from "@domos/ui/dialog";
import { Checkbox, TextField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useState } from "react";
import { client } from "../../../client.ts";
import {
  refreshBotWork,
  type WorkAction,
  type WorkData,
} from "./use-bot-work.ts";

type Entry = WorkData["memory"][number];

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
  const [selected, setSelected] = useState<Entry | null | "new">(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSelected(null);
        onOpenChange(next);
      }}
      title={
        selected === "new" ? (
          "新增记忆"
        ) : selected ? (
          "编辑记忆"
        ) : (
          <span className="memory-title">
            记忆
            <Button
              variant="ghost"
              size="icon-small"
              disabled={action.busy}
              onClick={() => setSelected("new")}
              aria-label="新增记忆"
            >
              <PlusIcon />
            </Button>
          </span>
        )
      }
      footer={
        !selected && (
          <div className="memory-footer">
            <Checkbox
              label="后台回顾"
              checked={reviewEnabled}
              disabled={action.busy}
              onCheckedChange={(enabled) =>
                void action.run(["memory.review", enabled], () =>
                  client.work.memory.review.setEnabled({ botId, enabled }),
                )
              }
            />
          </div>
        )
      }
    >
      {action.error && (
        <p role="alert" className="alert">
          {action.error}
        </p>
      )}
      {selected ? (
        <MemoryEditor
          botId={botId}
          entry={selected === "new" ? null : selected}
          action={action}
          onDone={() => setSelected(null)}
        />
      ) : (
        <section className="detail-page" aria-label="记忆">
          <p className="detail-note">
            用户档案会进入每轮上下文。工作笔记由 Bot 按需搜索。 档案：
            {usage.profile} B / 8 KB；笔记：{usage.work} B / 24 KB。
          </p>
          {candidates.length > 0 && (
            <section aria-label="待确认记忆" className="detail-page">
              <h3>待确认</h3>
              {candidates.map((candidate) => (
                <div key={candidate.id} className="item-card">
                  <p>{candidate.input.text}</p>
                  <div className="form-actions">
                    <Button
                      size="small"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(
                          ["memory.accept", candidate.id],
                          () =>
                            client.work.memory.resolve({
                              botId,
                              id: candidate.id,
                              accept: true,
                            }),
                          refreshBotWork,
                        )
                      }
                    >
                      保存记忆
                    </Button>
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(
                          ["memory.dismiss", candidate.id],
                          () =>
                            client.work.memory.resolve({
                              botId,
                              id: candidate.id,
                              accept: false,
                            }),
                          refreshBotWork,
                        )
                      }
                    >
                      忽略
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          )}
          {items.length ? (
            <ul className="item-list">
              {items.map((entry) => (
                <li key={entry.id} className="item-card">
                  <button
                    className="item-open item-text"
                    type="button"
                    onClick={() => setSelected(entry)}
                  >
                    {entry.text}
                  </button>
                  <div className="item-meta">
                    <span className="item-tag">
                      {(entry.category ?? "work") === "profile"
                        ? "用户档案"
                        : "工作笔记"}
                    </span>
                    <span>{entry.botId === null ? "共享" : "此 Bot"}</span>
                    <span>
                      {entry.origin === "user"
                        ? "用户原话"
                        : entry.origin === "tool"
                          ? "工具观察"
                          : entry.origin === "inference"
                            ? "模型推断"
                            : entry.source.startsWith("bot:")
                              ? "Bot 记录"
                              : "你添加"}
                    </span>
                    {entry.effectiveAt && (
                      <time dateTime={entry.effectiveAt}>
                        {new Date(entry.effectiveAt).toLocaleDateString()} 起
                      </time>
                    )}
                    {entry.evidence?.map((ref, index) => (
                      <Button
                        key={`${ref.entryId}:${ref.quote}`}
                        variant="ghost"
                        size="small"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(
                            ["memory.evidence", entry.id, index],
                            async () => {
                              const value = await client.work.memory.evidence({
                                botId,
                                id: entry.id,
                                index,
                              });
                              await onEvidence(value);
                              onOpenChange(false);
                            },
                          )
                        }
                      >
                        查看出处
                        {entry.evidence && entry.evidence.length > 1
                          ? ` ${index + 1}`
                          : ""}
                      </Button>
                    ))}
                  </div>
                  <div className="item-actions">
                    <ActionMenu
                      label="记忆操作"
                      disabled={action.busy}
                      items={[
                        { label: "编辑", onSelect: () => setSelected(entry) },
                        {
                          label: "删除",
                          tone: "danger",
                          onSelect: () => setDeleting(entry),
                        },
                      ]}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : candidates.length === 0 ? (
            <p className="detail-empty">暂无记忆</p>
          ) : null}
        </section>
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
              refreshBotWork,
            );
        }}
      />
    </Dialog>
  );
}

function MemoryEditor({
  botId,
  entry,
  action,
  onDone,
}: {
  botId: number;
  entry: Entry | null;
  action: WorkAction;
  onDone: () => void;
}) {
  const [id] = useState(() => entry?.id ?? crypto.randomUUID());
  const [text, setText] = useState(entry?.text ?? "");
  const [category, setCategory] = useState<"profile" | "work">(
    entry ? (entry.category ?? "work") : "profile",
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
      className="bot-form"
      aria-busy={action.busy}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(
          ["memory.save", input],
          (requestId) => client.work.memory.save({ ...input, requestId }),
          () => {
            refreshBotWork();
            onDone();
          },
        );
      }}
    >
      <fieldset className="bot-fields" disabled={action.busy}>
        <SegmentedControl
          label="记忆类别"
          value={category}
          onValueChange={(value) => setCategory(value as "profile" | "work")}
          options={[
            { value: "profile", label: "用户档案" },
            { value: "work", label: "工作笔记" },
          ]}
        />
        <TextField
          label="内容"
          value={text}
          onValueChange={setText}
          multiline
          required
          autoFocus
          maxLength={WORK_TEXT_LENGTH}
        />
        <Checkbox
          label="共享给所有 Bot"
          checked={shared}
          onCheckedChange={setShared}
        />
        <DialogFooter>
          <div className="dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="small"
              onClick={onDone}
              disabled={action.busy}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="memory-editor"
              size="small"
              pending={action.busy}
              disabled={action.busy || !text.trim()}
            >
              保存
            </Button>
          </div>
        </DialogFooter>
      </fieldset>
    </form>
  );
}
