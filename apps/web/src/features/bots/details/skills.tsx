import { SKILL_FILE_BYTES } from "@domos/agent/work/limits";
import { Button, Switch } from "@domos/ui/controls";
import { ConfirmDialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { useRef, useState } from "react";
import { client } from "../../../client.ts";
import type { PanelEditor } from "./types.ts";
import type { WorkAction, WorkData } from "./use-bot-work.ts";

const template =
  "---\nname: my-skill\ndescription: 说明何时使用这个技能\n---\n\n## 步骤\n\n## 验证与交付\n";

type Skill = WorkData["skills"][number];

export function SkillsPanel({
  botId,
  items,
  action,
  editor,
  onEditorChange,
}: {
  botId: number;
  items: WorkData["skills"];
  action: WorkAction;
  editor: Extract<PanelEditor, { view: "skills" }> | null;
  onEditorChange: (editor: PanelEditor | null) => void;
}) {
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const start = (skill: Skill | null, content: string) =>
    onEditorChange({
      view: "skills",
      skill,
      content,
      token: crypto.randomUUID(),
    });
  const exportSkill = (skill: Skill) => {
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
  };
  return (
    <section className="detail-page" aria-label="技能">
      {!editor && (
        <header className="detail-page-head">
          <span className="detail-note">{items.length} 个技能</span>
          <div className="detail-inline">
            <Button
              variant="secondary"
              size="small"
              disabled={action.busy}
              onClick={() => file.current?.click()}
            >
              导入
            </Button>
            <Button
              size="small"
              disabled={action.busy}
              onClick={() => start(null, template)}
            >
              新建技能
            </Button>
          </div>
        </header>
      )}

      <input
        className="sr-only"
        ref={file}
        type="file"
        accept=".md,text/markdown"
        aria-label="导入 SKILL.md"
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
                  throw new Error("SKILL.md 超过 256 KiB。");
                start(null, await selected.text());
              },
            );
        }}
      />

      {editor && (
        <SkillEditor
          key={editor.token}
          botId={botId}
          skill={editor.skill}
          content={editor.content}
          action={action}
          onDone={() => onEditorChange(null)}
        />
      )}

      {!editor &&
        (items.length ? (
          <ul className="item-list">
            {items.map((skill) => {
              const enabled = skill.enabledBots.includes(botId);
              return (
                <li key={skill.id} className="item-card">
                  <div className="item-heading">
                    <button
                      className="item-heading-copy item-open"
                      type="button"
                      onClick={() => start(skill, skill.content)}
                    >
                      <h3>{skill.name}</h3>
                      <p className="item-description">
                        {skill.description || "暂无说明"}
                      </p>
                    </button>
                    <Switch
                      label={`为此 Bot 启用 ${skill.name}`}
                      checked={enabled}
                      disabled={action.busy}
                      onCheckedChange={(next) =>
                        void action.run(
                          ["skills.enable", skill.id, skill.revision, next],
                          (requestId) =>
                            client.work.skills.enable({
                              botId,
                              id: skill.id,
                              enabled: next,
                              revision: skill.revision,
                              requestId,
                            }),
                        )
                      }
                    />
                  </div>
                  <div className="item-meta">
                    <span
                      className="item-tag"
                      data-tone={enabled ? "ready" : undefined}
                    >
                      {enabled ? "此 Bot 已启用" : "此 Bot 未启用"}
                    </span>
                    <span>{skill.enabledBots.length} 个 Bot 使用</span>
                  </div>
                  <div className="item-actions">
                    <ActionMenu
                      label={`${skill.name}的操作`}
                      disabled={action.busy}
                      items={[
                        {
                          label: "编辑",
                          onSelect: () => start(skill, skill.content),
                        },
                        {
                          label: "导出",
                          onSelect: () => exportSkill(skill),
                        },
                        {
                          label: "删除",
                          tone: "danger",
                          onSelect: () => setDeleting(skill),
                        },
                      ]}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="detail-empty">暂无技能</p>
        ))}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="删除这个技能？"
        description="此技能会从共享库移除，已启用它的 Bot 将不再使用。"
        onConfirm={() => {
          const skill = deleting;
          setDeleting(null);
          if (skill)
            void action.run(
              ["skills.delete", skill.id, skill.revision],
              () =>
                client.work.skills.delete({
                  botId,
                  id: skill.id,
                  revision: skill.revision,
                }),
              () => {
                if (editor?.skill?.id === skill.id) onEditorChange(null);
              },
            );
        }}
      />
    </section>
  );
}

function SkillEditor({
  botId,
  skill,
  content: initialContent,
  action,
  onDone,
}: {
  botId: number;
  skill: Skill | null;
  content: string;
  action: WorkAction;
  onDone: () => void;
}) {
  const [id] = useState(() => skill?.id ?? crypto.randomUUID());
  const [content, setContent] = useState(initialContent);
  const input = {
    botId,
    id,
    revision: skill?.revision ?? 0,
    content,
  };
  return (
    <form
      className="bot-form detail-card"
      aria-busy={action.busy}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(
          ["skills.save", input],
          (requestId) => client.work.skills.save({ ...input, requestId }),
          onDone,
        );
      }}
    >
      <fieldset className="bot-fields" disabled={action.busy}>
        <TextField
          label={skill ? "编辑 SKILL.md" : "新建 SKILL.md"}
          value={content}
          onValueChange={setContent}
          multiline
          required
          autoFocus
          maxLength={SKILL_FILE_BYTES}
        />
        <div className="form-actions">
          <Button type="button" variant="ghost" size="small" onClick={onDone}>
            取消
          </Button>
          <Button
            type="submit"
            size="small"
            aria-label="保存技能"
            pending={action.busy}
            disabled={!content.trim()}
          >
            保存
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
