import { WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { SegmentedControl } from "@domos/ui/choice";
import { Button } from "@domos/ui/controls";
import { ConfirmDialog, Dialog } from "@domos/ui/dialog";
import { Checkbox, TextField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useState } from "react";
import { client } from "../../../client.ts";
import type { WorkAction, WorkData } from "./use-bot-work.ts";

type Entry = WorkData["memory"][number];

export function MemoryDialog({
  open,
  onOpenChange,
  botId,
  items,
  reviewEnabled,
  usage,
  action,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botId: number;
  items: Entry[];
  reviewEnabled: boolean;
  usage: WorkData["memoryUsage"];
  action: WorkAction;
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
                      {entry.source.startsWith("bot:") ? "Bot 记录" : "你添加"}
                    </span>
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
          ) : (
            <p className="detail-empty">暂无记忆</p>
          )}
        </section>
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="删除这条记忆？"
        description="删除后，Bot 将不再使用这条记忆。"
        onConfirm={() => {
          const entry = deleting;
          setDeleting(null);
          if (entry)
            void action.run(["memory.delete", entry.id, entry.revision], () =>
              client.work.memory.delete({
                botId,
                id: entry.id,
                revision: entry.revision,
              }),
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
      className="bot-form"
      aria-busy={action.busy}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(
          ["memory.save", input],
          (requestId) => client.work.memory.save({ ...input, requestId }),
          onDone,
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
        <div className="form-actions">
          <Button type="button" variant="ghost" size="small" onClick={onDone}>
            取消
          </Button>
          <Button
            type="submit"
            size="small"
            pending={action.busy}
            disabled={!text.trim()}
          >
            保存
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
