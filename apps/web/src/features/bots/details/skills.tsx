import {
  SKILL_FILE_BYTES,
  SKILL_PACKAGE_BYTES,
} from "@domos/agent/work/limits";
import { Button, Switch } from "@domos/ui/controls";
import { ConfirmDialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { useRef, useState } from "react";
import { client } from "../../../client.ts";
import { useModelSettings } from "../../models/model-state.ts";
import type { PanelEditor } from "./types.ts";
import type { WorkAction, WorkData } from "./use-bot-work.ts";

const template =
  "---\nname: my-skill\ndescription: 说明何时使用这个技能\n---\n\n## 步骤\n\n## 验证与交付\n";

type Skill = WorkData["skills"][number];

export function SkillsPanel({
  botId,
  items,
  nativeSkills,
  action,
  editor,
  onEditorChange,
}: {
  botId: number;
  items: WorkData["skills"];
  nativeSkills: WorkData["nativeSkills"];
  action: WorkAction;
  editor: Extract<PanelEditor, { view: "skills" }> | null;
  onEditorChange: (editor: PanelEditor | null) => void;
}) {
  const { profile } = useModelSettings(botId);
  const native = nativeSkills ?? profile?.connection?.controls?.skills;
  const managed = items.filter(
    (skill) => !native?.some((item) => item.name === skill.name),
  );
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const start = (skill: Skill | null, content: string, archive?: string) =>
    onEditorChange({
      view: "skills",
      skill,
      content,
      archive,
      token: crypto.randomUUID(),
    });
  const exportSkill = (skill: Skill) =>
    void action.run(["skills.export", skill.id], async () => {
      const result = await client.work.skills.export({ botId, id: skill.id });
      const bytes = Uint8Array.from(atob(result.archive), (char) =>
        char.charCodeAt(0),
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/zip" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${result.name}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    });
  return (
    <section className="detail-page" aria-label="技能">
      {!editor && (
        <header className="detail-page-head">
          <span className="detail-note">
            {managed.length + (native?.length ?? 0)} 个技能
          </span>
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
        disabled={action.busy}
        accept=".zip,.md,application/zip,text/markdown"
        aria-label="导入技能包"
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
                if (selected.size > SKILL_PACKAGE_BYTES)
                  throw new Error("技能包超过 8 MiB。");
                const archive = selected.name.toLowerCase().endsWith(".zip")
                  ? await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () =>
                        resolve(String(reader.result).split(",")[1] ?? "");
                      reader.onerror = reject;
                      reader.readAsDataURL(selected);
                    })
                  : undefined;
                const preview = await client.work.skills.preview({
                  botId,
                  content: archive ? "" : await selected.text(),
                  archive,
                });
                const existing = items.find(
                  (skill) => skill.name === preview.name,
                );
                if (native?.some((skill) => skill.name === preview.name))
                  throw new Error("此技能由原生 Harness 管理。");
                start(existing ?? null, preview.content, archive);
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
          archive={editor.archive}
          action={action}
          onDone={() => onEditorChange(null)}
        />
      )}

      {!editor &&
        (native === undefined ? (
          <p className="detail-note">引擎尚未提供原生技能目录。</p>
        ) : (
          native.length > 0 && (
            <ul className="item-list" aria-label="原生技能">
              {native.map((skill) => (
                <li key={skill.path ?? skill.name} className="item-card">
                  <h3>{skill.name}</h3>
                  <p className="item-description">{skill.description}</p>
                  <p className="item-note">{skill.source} · 原生只读</p>
                  {skill.path && <p className="item-note">{skill.path}</p>}
                </li>
              ))}
            </ul>
          )
        ))}
      {!editor &&
        (managed.length ? (
          <ul className="item-list">
            {managed.map((skill) => {
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
                    <span>
                      {skill.source} · v{skill.versions?.at(-1)?.version ?? 1}
                    </span>
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
        ) : !native?.length ? (
          <p className="detail-empty">暂无技能</p>
        ) : null)}

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
  archive: initialArchive,
  action,
  onDone,
}: {
  botId: number;
  skill: Skill | null;
  content: string;
  archive?: string;
  action: WorkAction;
  onDone: () => void;
}) {
  const [id] = useState(() => skill?.id ?? crypto.randomUUID());
  const [content, setContent] = useState(initialContent);
  const [archive, setArchive] = useState(initialArchive);
  const [preview, setPreview] =
    useState<Awaited<ReturnType<typeof client.work.skills.preview>>>();
  const changeContent = (value: string) => {
    setContent(value);
    setPreview(undefined);
  };
  const input = {
    botId,
    id,
    revision: skill?.revision ?? 0,
    content,
    archive,
  };
  return (
    <form
      className="bot-form"
      aria-busy={action.busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (!preview)
          void action.run(
            ["skills.preview", input],
            () => client.work.skills.preview(input),
            setPreview,
          );
        else
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
          onValueChange={changeContent}
          multiline
          required
          autoFocus
          maxLength={SKILL_FILE_BYTES}
        />
        {skill?.versions && skill.versions.length > 1 && (
          <details>
            <summary>版本历史</summary>
            {[...skill.versions].reverse().map((version) => (
              <Button
                key={version.version}
                size="small"
                variant="ghost"
                type="button"
                onClick={() =>
                  void action.run(
                    ["skills.version", skill.id, version.hash],
                    async () => {
                      const result = await client.work.skills.export({
                        botId,
                        id: skill.id,
                        hash: version.hash,
                      });
                      const preview = await client.work.skills.preview({
                        botId,
                        id: skill.id,
                        content: "",
                        archive: result.archive,
                      });
                      setArchive(result.archive);
                      setContent(preview.content);
                      setPreview(preview);
                    },
                  )
                }
              >
                预览 v{version.version} · {version.hash.slice(0, 8)}
              </Button>
            ))}
          </details>
        )}
        {preview && (
          <section aria-label="技能差异">
            <p className="detail-note">
              {preview.hash.slice(0, 12)} · {preview.changes.length} 个文件变更
            </p>
            {preview.changes.map((change) => (
              <details key={change.path}>
                <summary>
                  {
                    { added: "新增", removed: "删除", changed: "修改" }[
                      change.status
                    ]
                  }{" "}
                  · {change.path}
                </summary>
                {change.before !== null && (
                  <div>
                    <p className="detail-note">当前版本</p>
                    <pre>{change.before}</pre>
                  </div>
                )}
                {change.after !== null && (
                  <div>
                    <p className="detail-note">待保存版本</p>
                    <pre>{change.after}</pre>
                  </div>
                )}
              </details>
            ))}
          </section>
        )}
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
            {preview ? "确认保存" : "预览更改"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
