import { WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { Button } from "@domos/ui/controls";
import { ConfirmDialog } from "@domos/ui/dialog";
import { Checkbox, TextField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { useState } from "react";
import { client } from "../../../client.ts";
import type { PanelEditor } from "./types.ts";
import type { WorkAction, WorkData } from "./use-bot-work.ts";

type MemoryEntry = WorkData["memory"][number];

export function MemoryPanel({
  botId,
  items,
  action,
  editor,
  onEditorChange,
}: {
  botId: number;
  items: WorkData["memory"];
  action: WorkAction;
  editor: Extract<PanelEditor, { view: "memory" }> | null;
  onEditorChange: (editor: PanelEditor | null) => void;
}) {
  const [deleting, setDeleting] = useState<MemoryEntry | null>(null);
  return (
    <section className="detail-page" aria-label="记忆">
      {!editor && (
        <header className="detail-page-head">
          <span className="detail-note">{items.length} 条记忆</span>
          <Button
            size="small"
            disabled={action.busy}
            onClick={() => onEditorChange({ view: "memory", entry: "new" })}
          >
            新增记忆
          </Button>
        </header>
      )}

      {editor && (
        <MemoryEditor
          key={editor.entry === "new" ? "new" : editor.entry.id}
          botId={botId}
          entry={editor.entry === "new" ? null : editor.entry}
          action={action}
          onDone={() => onEditorChange(null)}
        />
      )}

      {!editor &&
        (items.length ? (
          <ul className="item-list">
            {items.map((entry) => (
              <li key={entry.id} className="item-card">
                <button
                  className="item-open item-text"
                  type="button"
                  onClick={() => onEditorChange({ view: "memory", entry })}
                >
                  {entry.text}
                </button>
                <div className="item-meta">
                  <span className="item-tag">
                    {entry.botId === null ? "共享" : "此 Bot"}
                  </span>
                  <span>
                    {entry.source === "agent" ? "Bot 记录" : "你添加"}
                  </span>
                </div>
                <div className="item-actions">
                  <ActionMenu
                    label="记忆操作"
                    disabled={action.busy}
                    items={[
                      {
                        label: "编辑",
                        onSelect: () =>
                          onEditorChange({ view: "memory", entry }),
                      },
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
          <p className="detail-empty">
            还没有记忆。Bot 会在需要时记住长期信息。
          </p>
        ))}
      {!editor && (
        <p className="detail-note">
          记忆默认属于此 Bot。共享后，所有 Bot 都能使用。请勿保存密钥。
        </p>
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
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
    </section>
  );
}

function MemoryEditor({
  botId,
  entry,
  action,
  onDone,
}: {
  botId: number;
  entry: MemoryEntry | null;
  action: WorkAction;
  onDone: () => void;
}) {
  const [id] = useState(() => entry?.id ?? crypto.randomUUID());
  const [text, setText] = useState(entry?.text ?? "");
  const [shared, setShared] = useState(entry ? entry.botId === null : false);
  const input = {
    botId,
    id,
    revision: entry?.revision ?? 0,
    text,
    shared,
  };
  return (
    <form
      className="bot-form detail-card"
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
        <TextField
          label={entry ? "修改记忆" : "新增记忆"}
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
          disabled={action.busy}
        />
        <div className="form-actions">
          <Button type="button" variant="ghost" size="small" onClick={onDone}>
            取消
          </Button>
          <Button
            type="submit"
            size="small"
            aria-label="保存记忆"
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
