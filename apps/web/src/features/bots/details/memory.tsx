import { WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { Button } from "@domos/ui/controls";
import { ConfirmButton } from "@domos/ui/dialog";
import { Checkbox, TextField } from "@domos/ui/field";
import { useState } from "react";
import { client } from "../../../client.ts";
import type { WorkAction, WorkData } from "./use-bot-work.ts";

type MemoryEntry = WorkData["memory"][number];

export function MemoryPanel({
  botId,
  items,
  action,
}: {
  botId: number;
  items: WorkData["memory"];
  action: WorkAction;
}) {
  const [editor, setEditor] = useState<MemoryEntry | "new" | null>(null);
  return (
    <section className="detail-page" aria-label="记忆">
      <header className="detail-page-head">
        <p className="detail-note">
          记忆默认只属于当前 Bot，共享后所有 Bot 都能读取和修改。请勿保存密钥。
        </p>
        {!editor && (
          <Button
            size="small"
            disabled={action.busy}
            onClick={() => setEditor("new")}
          >
            新增记忆
          </Button>
        )}
      </header>

      {editor && (
        <MemoryEditor
          key={editor === "new" ? "new" : editor.id}
          botId={botId}
          entry={editor === "new" ? null : editor}
          action={action}
          onDone={() => setEditor(null)}
        />
      )}

      {items.length ? (
        <ul className="item-list">
          {items.map((entry) => (
            <li key={entry.id} className="item-card">
              <p className="item-text">{entry.text}</p>
              <div className="item-meta">
                <span className="item-tag">
                  {entry.botId === null ? "共享" : "此 Bot"}
                </span>
                <span>{entry.source === "agent" ? "Bot 记录" : "你添加"}</span>
              </div>
              <div className="item-actions">
                <Button
                  variant="ghost"
                  size="small"
                  disabled={action.busy}
                  onClick={() => setEditor(entry)}
                >
                  编辑
                </Button>
                <ConfirmButton
                  title="删除这条记忆？"
                  description="删除后，Bot 将不再使用这条记忆。"
                  disabled={action.busy}
                  onConfirm={() => {
                    void action.run(
                      ["memory.delete", entry.id, entry.revision],
                      () =>
                        client.work.memory.delete({
                          botId,
                          id: entry.id,
                          revision: entry.revision,
                        }),
                      () => {
                        if (editor !== "new" && editor?.id === entry.id)
                          setEditor(null);
                      },
                    );
                  }}
                >
                  删除
                </ConfirmButton>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="detail-empty">还没有记忆。Bot 会在需要时记住长期信息。</p>
      )}
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
