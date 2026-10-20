import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { Button, Switch } from "@domos/ui/controls";
import { ConfirmDialog } from "@domos/ui/dialog";
import { Checkbox, TextField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { ChoicePicker } from "@domos/ui/picker";
import { useState } from "react";
import { client } from "../../../client.ts";
import { RoutineSchedule, routineTimeLabel } from "./routine-schedule.tsx";
import type { PanelEditor } from "./types.ts";
import type { WorkAction, WorkData } from "./use-bot-work.ts";

type Routine = WorkData["routines"]["items"][number];
const runLabels = {
  queued: "已提交／等待结果",
  done: "已完成",
  failed: "失败",
  stopped: "已停止",
};

function localTime(iso: string) {
  const date = new Date(iso);
  const parts = [
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  ].map((part) => String(part).padStart(2, "0"));
  return `${date.getFullYear()}-${parts[0]}-${parts[1]}T${parts[2]}:${parts[3]}`;
}

function scheduleLabel(routine: Routine) {
  return routine.schedule.type === "once"
    ? new Date(routine.schedule.at).toLocaleString()
    : `${routineTimeLabel(routine.schedule.expression)} · ${routine.schedule.timeZone}`;
}

export function RoutinesPanel({
  botId,
  data,
  skills,
  action,
  editor,
  onEditorChange,
}: {
  botId: number;
  data: WorkData["routines"];
  skills: WorkData["skills"];
  action: WorkAction;
  editor: Extract<PanelEditor, { view: "routines" }> | null;
  onEditorChange: (editor: PanelEditor | null) => void;
}) {
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const runs = [...data.runs].reverse();
  return (
    <section className="detail-page" aria-label="定时">
      {!editor && (
        <header className="detail-page-head">
          <span className="detail-note">{data.items.length} 个计划</span>
          <Button
            size="small"
            disabled={action.busy}
            onClick={() =>
              onEditorChange({
                view: "routines",
                routine: null,
                token: crypto.randomUUID(),
              })
            }
          >
            新建定时任务
          </Button>
        </header>
      )}

      {editor && (
        <RoutineEditor
          key={editor.token}
          botId={botId}
          routine={editor.routine}
          skills={skills}
          action={action}
          onCancel={() => onEditorChange(null)}
          onSaved={() => onEditorChange(null)}
        />
      )}

      {!editor &&
        (data.items.length ? (
          <ul className="item-list">
            {data.items.map((routine) => (
              <li key={routine.id} className="item-card">
                <div className="item-heading">
                  <button
                    type="button"
                    className="item-heading-copy item-open"
                    onClick={() =>
                      onEditorChange({
                        view: "routines",
                        routine,
                        token: crypto.randomUUID(),
                      })
                    }
                  >
                    <h3>{routine.title}</h3>
                    <p className="item-description">{routine.instructions}</p>
                  </button>
                  <Switch
                    label={`启用 ${routine.title}`}
                    checked={routine.enabled}
                    disabled={action.busy}
                    onCheckedChange={(next) =>
                      void action.run(
                        ["routines.enable", routine.id, routine.revision, next],
                        (requestId) =>
                          client.work.routines.enable({
                            botId,
                            id: routine.id,
                            enabled: next,
                            revision: routine.revision,
                            requestId,
                          }),
                      )
                    }
                  />
                </div>
                <div className="item-meta">
                  <span
                    className="item-tag"
                    data-tone={routine.enabled ? "ready" : undefined}
                  >
                    {routine.enabled ? "运行中" : "已暂停"}
                  </span>
                  <span>{scheduleLabel(routine)}</span>
                </div>
                {routine.nextAt && (
                  <p className="item-note">
                    下次：{new Date(routine.nextAt).toLocaleString()}
                  </p>
                )}
                <div className="item-actions">
                  <ActionMenu
                    label={`${routine.title}的操作`}
                    disabled={action.busy}
                    items={[
                      {
                        label: "试跑",
                        onSelect: () =>
                          void action.run(
                            ["routines.test", routine.id],
                            (requestId) =>
                              client.work.routines.test({
                                botId,
                                id: routine.id,
                                requestId,
                              }),
                          ),
                      },
                      {
                        label: "编辑",
                        onSelect: () =>
                          onEditorChange({
                            view: "routines",
                            routine,
                            token: crypto.randomUUID(),
                          }),
                      },
                      {
                        label: "删除",
                        tone: "danger",
                        onSelect: () => setDeleting(routine),
                      },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="detail-empty">
            还没有定时任务。可以安排一次提醒，或让 Bot 定期整理资料。
          </p>
        ))}

      {!editor && (
        <details className="detail-disclosure">
          <summary>
            运行记录
            {runs.length > 0 && (
              <span className="disclosure-count">{runs.length}</span>
            )}
          </summary>
          <div className="detail-disclosure-body">
            {runs.length ? (
              <ul className="run-list">
                {runs.map((run) => (
                  <li key={run.id}>
                    <div className="run-heading">
                      <strong>{run.title}</strong>
                      <span>{run.mode === "test" ? "试跑" : "定时"}</span>
                    </div>
                    <p className="item-note">{runLabels[run.status]}</p>
                    <p className="item-note">
                      计划：{new Date(run.scheduledAt).toLocaleString()}；触发：
                      {new Date(run.firedAt).toLocaleString()}
                    </p>
                    {run.coalesced && (
                      <p className="item-note">
                        已将停机期间错过的周期合并为本次执行。
                      </p>
                    )}
                    {run.error && <p role="status">{run.error}</p>}
                    {run.status === "done" && (
                      <p className="item-note">结果已发回此 Bot 的聊天。</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="detail-note">还没有运行记录。</p>
            )}
          </div>
        </details>
      )}
      {!editor && (
        <p className="detail-note">
          服务运行时，Bot 会按计划工作。新任务默认暂停。试跑会真实执行。
        </p>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="删除这个定时任务？"
        description="已开始的工作仍会完成。"
        onConfirm={() => {
          const routine = deleting;
          setDeleting(null);
          if (routine)
            void action.run(
              ["routines.delete", routine.id, routine.revision],
              () =>
                client.work.routines.delete({
                  botId,
                  id: routine.id,
                  revision: routine.revision,
                }),
              () => {
                if (editor?.routine?.id === routine.id) onEditorChange(null);
              },
            );
        }}
      />
    </section>
  );
}

function RoutineEditor({
  botId,
  routine,
  skills,
  action,
  onCancel,
  onSaved,
}: {
  botId: number;
  routine: Routine | null;
  skills: WorkData["skills"];
  action: WorkAction;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [id] = useState(() => routine?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(routine?.title ?? "");
  const [instructions, setInstructions] = useState(routine?.instructions ?? "");
  const [type, setType] = useState<"once" | "cron">(
    routine?.schedule.type ?? "cron",
  );
  const [at, setAt] = useState(
    routine?.schedule.type === "once" ? localTime(routine.schedule.at) : "",
  );
  const [expression, setExpression] = useState(
    routine?.schedule.type === "cron"
      ? routine.schedule.expression
      : "0 9 * * *",
  );
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [timeZone, setTimeZone] = useState(
    routine?.schedule.timeZone ?? localZone,
  );
  const [skillIds, setSkillIds] = useState(routine?.skillIds ?? []);
  return (
    <form
      className="bot-form detail-card"
      aria-busy={action.busy}
      onSubmit={(event) => {
        event.preventDefault();
        const schedule =
          type === "once"
            ? { type, at: new Date(at).toISOString(), timeZone: localZone }
            : { type, expression, timeZone };
        const input = {
          botId,
          id,
          revision: routine?.revision ?? 0,
          title,
          instructions,
          schedule,
          skillIds,
        };
        void action.run(
          ["routines.save", input],
          (requestId) => client.work.routines.save({ ...input, requestId }),
          onSaved,
        );
      }}
    >
      <fieldset className="bot-fields" disabled={action.busy}>
        <div className="detail-form-head">
          <h3>{routine ? "编辑定时任务" : "新建定时任务"}</h3>
          <p className="detail-note">保存后默认暂停，需要手动启用。</p>
        </div>
        <TextField
          label={routine ? "修改任务名称" : "新任务名称"}
          value={title}
          onValueChange={setTitle}
          required
          maxLength={BOT_NAME_LENGTH}
        />
        <TextField
          label="工作要求与交付方式"
          value={instructions}
          onValueChange={setInstructions}
          multiline
          required
          maxLength={WORK_TEXT_LENGTH}
        />
        <div className="field">
          <span className="field-label">执行方式</span>
          <ChoicePicker
            label="执行方式"
            value={type}
            onValueChange={(value) => setType(value as "once" | "cron")}
            items={[
              { value: "cron", label: "周期执行" },
              { value: "once", label: "执行一次" },
            ]}
          />
        </div>
        {type === "once" ? (
          <label className="field">
            <span className="field-label">执行时间（{localZone}）</span>
            <input
              className="field-control"
              type="datetime-local"
              value={at}
              onChange={(event) => setAt(event.target.value)}
              required
            />
          </label>
        ) : (
          <RoutineSchedule
            expression={expression}
            onExpressionChange={setExpression}
            timeZone={timeZone}
            onTimeZoneChange={setTimeZone}
          />
        )}
        {skills
          .filter((skill) => skill.enabledBots.includes(botId))
          .map((skill) => (
            <Checkbox
              key={skill.id}
              label={skill.name}
              checked={skillIds.includes(skill.id)}
              disabled={action.busy}
              onCheckedChange={(checked) =>
                setSkillIds(
                  checked
                    ? [...skillIds, skill.id]
                    : skillIds.filter((id) => id !== skill.id),
                )
              }
            />
          ))}
        <div className="form-actions">
          <Button type="button" variant="ghost" size="small" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" size="small" aria-label="保存为暂停">
            保存
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
