import { WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { Button } from "@domos/ui/controls";
import { ConfirmButton } from "@domos/ui/dialog";
import { Checkbox, TextField } from "@domos/ui/field";
import { useState } from "react";
import { client } from "../../../client.ts";
import type { WorkAction, WorkData } from "./use-bot-work.ts";

export function MemoryPanel({
  botId,
  items,
  action,
}: {
  botId: number;
  items: WorkData["memory"];
  action: WorkAction;
}) {
  const [editing, setEditing] = useState<WorkData["memory"][number] | null>(
    null,
  );
  const [id, setId] = useState(() => crypto.randomUUID());
  const [text, setText] = useState("");
  const [shared, setShared] = useState(false);
  function clear() {
    setEditing(null);
    setId(crypto.randomUUID());
    setText("");
    setShared(false);
  }
  const input = {
    botId,
    id: editing?.id ?? id,
    revision: editing?.revision ?? 0,
    text,
    shared,
  };
  return (
    <div className="detail-stack">
      <p className="detail-note">
        记忆默认只属于当前Bot。共享后所有Bot均可读取和修改。请勿保存密钥。
      </p>
      <form
        className="bot-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(
            ["memory.save", input],
            (requestId) => client.work.memory.save({ ...input, requestId }),
            clear,
          );
        }}
      >
        <fieldset className="bot-fields" disabled={action.busy}>
          <TextField
            label={editing ? "修改记忆" : "新增记忆"}
            value={text}
            onValueChange={setText}
            multiline
            required
            maxLength={WORK_TEXT_LENGTH}
          />
          <Checkbox
            label="共享给所有Bot"
            checked={shared}
            onCheckedChange={setShared}
            disabled={action.busy}
          />
          <div className="form-actions">
            {editing && (
              <Button
                type="button"
                size="small"
                variant="secondary"
                onClick={clear}
              >
                取消编辑
              </Button>
            )}
            <Button type="submit" size="small" disabled={!text.trim()}>
              保存记忆
            </Button>
          </div>
        </fieldset>
      </form>
      <ul className="detail-list">
        {items.map((entry) => (
          <li key={entry.id}>
            <p className="detail-text">{entry.text}</p>
            <p className="detail-note">
              {entry.botId === null ? "共享" : "此Bot"} · 版本{entry.revision} ·
              来源：{entry.source}
            </p>
            <div className="detail-actions">
              <Button
                variant="ghost"
                size="small"
                disabled={action.busy}
                onClick={() => {
                  setEditing(entry);
                  setText(entry.text);
                  setShared(entry.botId === null);
                }}
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
                      if (editing?.id === entry.id) clear();
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
      {!items.length && <p className="detail-note">暂无保存的记忆。</p>}
    </div>
  );
}
