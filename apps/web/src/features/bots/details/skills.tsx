import { SKILL_FILE_BYTES } from "@domos/agent/work/limits";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { useRef, useState } from "react";
import { client } from "../../../client.ts";
import type { WorkAction, WorkData } from "./use-bot-work.ts";

const template =
  "---\nname: my-skill\ndescription: 说明何时使用这个技能\n---\n\n## 步骤\n\n## 验证与交付\n";

export function SkillsPanel({
  botId,
  items,
  action,
}: {
  botId: number;
  items: WorkData["skills"];
  action: WorkAction;
}) {
  const [editing, setEditing] = useState<WorkData["skills"][number] | null>(
    null,
  );
  const [id, setId] = useState(() => crypto.randomUUID());
  const [content, setContent] = useState(template);
  const file = useRef<HTMLInputElement>(null);
  const input = {
    botId,
    id: editing?.id ?? id,
    revision: editing?.revision ?? 0,
    content,
  };
  function clear() {
    setEditing(null);
    setId(crypto.randomUUID());
    setContent(template);
  }
  return (
    <div className="detail-stack">
      <p className="detail-note">
        技能库由所有Bot共享。导入后请检查正文，再为此Bot启用。修改技能会影响已启用它的其他Bot。技能不会增加工具权限。
      </p>
      <input
        className="sr-only"
        ref={file}
        type="file"
        accept=".md,text/markdown"
        aria-label="导入SKILL.md"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (selected)
            void action.run(
              [
                "skill.import",
                selected.name,
                selected.size,
                selected.lastModified,
              ],
              async () => {
                if (selected.size > SKILL_FILE_BYTES)
                  throw new Error("SKILL.md超过256 KiB。");
                setContent(await selected.text());
                setEditing(null);
                setId(crypto.randomUUID());
              },
            );
        }}
      />
      <form
        className="bot-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(
            ["skills.save", input],
            (requestId) => client.work.skills.save({ ...input, requestId }),
            clear,
          );
        }}
      >
        <fieldset className="bot-fields" disabled={action.busy}>
          <div className="detail-actions">
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={() => file.current?.click()}
            >
              导入文件
            </Button>
            {editing && (
              <Button
                type="button"
                variant="secondary"
                size="small"
                onClick={clear}
              >
                新建技能
              </Button>
            )}
          </div>
          <TextField
            label={editing ? "编辑SKILL.md" : "新建SKILL.md"}
            value={content}
            onValueChange={setContent}
            multiline
            required
            maxLength={SKILL_FILE_BYTES}
          />
          <div className="form-actions">
            <Button type="submit" size="small">
              保存技能
            </Button>
          </div>
        </fieldset>
      </form>
      <ul className="detail-list">
        {items.map((skill) => (
          <li key={skill.id}>
            <strong>{skill.name}</strong>
            <p>{skill.description}</p>
            <p className="detail-note">
              版本{skill.revision} ·{" "}
              {skill.enabledBots.includes(botId)
                ? "此Bot已启用"
                : "此Bot未启用"}
            </p>
            <div className="detail-actions">
              <Button
                variant="secondary"
                size="small"
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    ["skills.enable", skill.id, skill.revision],
                    (requestId) =>
                      client.work.skills.enable({
                        botId,
                        id: skill.id,
                        enabled: !skill.enabledBots.includes(botId),
                        revision: skill.revision,
                        requestId,
                      }),
                  )
                }
              >
                {skill.enabledBots.includes(botId) ? "停用" : "启用"}
              </Button>
              <Button
                variant="ghost"
                size="small"
                disabled={action.busy}
                onClick={() => {
                  setEditing(skill);
                  setContent(skill.content);
                }}
              >
                编辑
              </Button>
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([skill.content], {
                      type: "text/markdown;charset=utf-8",
                    }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `${skill.name}.md`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                导出
              </Button>
              <Button
                variant="ghost"
                size="small"
                disabled={action.busy}
                onClick={() => {
                  if (window.confirm("从共享库删除这个技能？"))
                    void action.run(
                      ["skills.delete", skill.id, skill.revision],
                      () =>
                        client.work.skills.delete({
                          botId,
                          id: skill.id,
                          revision: skill.revision,
                        }),
                      () => {
                        if (editing?.id === skill.id) clear();
                      },
                    );
                }}
              >
                删除
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
