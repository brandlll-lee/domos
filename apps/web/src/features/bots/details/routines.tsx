import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { Button, Switch } from "@domos/ui/controls";
import { ConfirmDialog } from "@domos/ui/dialog";
import { Checkbox, TextField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { useState } from "react";
import { client } from "../../../client.ts";
import type { useChat } from "../../chat/use-chat.ts";
import { WorkPanel } from "../../chat/work.tsx";
import { RoutineSchedule, routineTimeLabel } from "./routine-schedule.tsx";
import type { PanelEditor } from "./types.ts";
import type { WorkAction, WorkData } from "./use-bot-work.ts";

type Routine = WorkData["routines"]["items"][number];
const runLabels = {
  queued: "排队中",
  running: "执行中",
  waiting_answer: "等待回答",
  waiting_approval: "等待审批",
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
  chat,
}: {
  chat: ReturnType<typeof useChat>;
  botId: number;
  data: WorkData["routines"];
  skills: WorkData["skills"];
  action: WorkAction;
  editor: Extract<PanelEditor, { view: "routines" }> | null;
  onEditorChange: (editor: PanelEditor | null) => void;
}) {
  const [selectedRun, setSelectedRun] = useState<string>();
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const runs = [...data.runs].reverse();
  const selected = runs.find((run) => run.turnId === selectedRun);
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
                  </button>
                </div>
                <div className="item-meta">
                  <span
                    className="item-tag"
                    data-tone={routine.enabled ? "ready" : undefined}
                  >
                    {routine.enabled ? "已启用" : "已暂停"}
                  </span>
                  <span>{scheduleLabel(routine)}</span>
                </div>
                {routine.nextAt && (
                  <p className="item-note">
                    下次：{new Date(routine.nextAt).toLocaleString()}
                  </p>
                )}
                <div className="item-actions">
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
          <p className="detail-empty">暂无定时任务</p>
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
                  <li key={run.id} data-state={run.status}>
                    <Button
                      variant="ghost"
                      className="routine-run"
                      disabled={!run.turnId}
                      aria-label={`查看工作记录：${run.title}`}
                      onClick={() => setSelectedRun(run.turnId)}
                    >
                      <span className="routine-run-copy">
                        <strong>{run.title}</strong>
                        <span className="item-note">
                          {new Date(run.firedAt).toLocaleString("zh-CN", {
                            month: "long",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                          {run.activeMs !== undefined &&
                            ` · 执行 ${(run.activeMs / 1000).toFixed(1)} 秒`}
                        </span>
                      </span>
                      <span className="routine-run-status">
                        {run.status === "done" && run.delivery === "conditional"
                          ? run.delivered
                            ? "已交付"
                            : "静默完成"
                          : runLabels[run.status]}
                      </span>
                      <CaretRightIcon aria-hidden="true" />
                    </Button>
                    {run.error && (
                      <p className="alert" role="status">
                        {run.error}
                      </p>
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

      {selectedRun && (
        <WorkPanel
          {...chat}
          botId={botId}
          selectedRun={selectedRun}
          onRunClose={() => setSelectedRun(undefined)}
          detailOnly
          runDetails={
            selected && (
              <dl className="approval-fields">
                <div>
                  <dt>执行方式</dt>
                  <dd>{selected.mode === "test" ? "试跑" : "定时"}</dd>
                </div>
                <div>
                  <dt>计划时间</dt>
                  <dd>{new Date(selected.scheduledAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>触发时间</dt>
                  <dd>{new Date(selected.firedAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>耗时</dt>
                  <dd>
                    执行 {((selected.activeMs ?? 0) / 1000).toFixed(1)} 秒 ·
                    等人 {((selected.waitingMs ?? 0) / 1000).toFixed(1)} 秒
                  </dd>
                </div>
                <div>
                  <dt>执行期限</dt>
                  <dd>
                    {Math.round((selected.executionMs ?? 900_000) / 60_000)}{" "}
                    分钟
                  </dd>
                </div>
                {selected.coalesced && (
                  <div>
                    <dt>错过的周期</dt>
                    <dd>已合并为本次执行</dd>
                  </div>
                )}
              </dl>
            )
          }
        />
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
  onSaved,
}: {
  botId: number;
  routine: Routine | null;
  skills: WorkData["skills"];
  action: WorkAction;
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
  const [minutes, setMinutes] = useState(
    String((routine?.executionMs ?? 900_000) / 60_000),
  );
  const [delivery, setDelivery] = useState<"always" | "conditional">(
    routine?.delivery ?? "always",
  );
  const [condition, setCondition] = useState(routine?.condition ?? "");
  const [skillIds, setSkillIds] = useState(routine?.skillIds ?? []);
  return (
    <form
      id={`routine-${botId}`}
      className="bot-form"
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
          delivery,
          condition: delivery === "conditional" ? condition : undefined,
          schedule,
          skillIds,
          executionMs: Math.round(Number(minutes) * 60_000),
        };
        void action.run(
          ["routines.save", input],
          (requestId) => client.work.routines.save({ ...input, requestId }),
          onSaved,
        );
      }}
    >
      <fieldset className="bot-fields" disabled={action.busy}>
        <TextField
          label="任务名称"
          value={title}
          onValueChange={setTitle}
          required
          maxLength={BOT_NAME_LENGTH}
        />
        <TextField
          label="工作要求"
          value={instructions}
          onValueChange={setInstructions}
          multiline
          required
          maxLength={WORK_TEXT_LENGTH}
        />
        <section className="settings-group" aria-label="执行安排">
          <div className="settings-card">
            <SettingRow title="执行方式">
              <ChoicePicker
                label="执行方式"
                value={type}
                onValueChange={(value) => setType(value as "once" | "cron")}
                items={[
                  { value: "cron", label: "周期执行" },
                  { value: "once", label: "执行一次" },
                ]}
              />
            </SettingRow>
            {type === "once" ? (
              <SettingRow title="执行时间" description={localZone}>
                <input
                  className="field-control"
                  aria-label="执行时间"
                  type="datetime-local"
                  value={at}
                  onChange={(event) => setAt(event.target.value)}
                  required
                />
              </SettingRow>
            ) : (
              <RoutineSchedule
                expression={expression}
                onExpressionChange={setExpression}
                timeZone={timeZone}
                onTimeZoneChange={setTimeZone}
              />
            )}
          </div>
        </section>
        <section className="settings-group" aria-label="交付设置">
          <div className="settings-card">
            <SettingRow title="交付方式">
              <ChoicePicker
                label="交付方式"
                value={delivery}
                onValueChange={(value) => setDelivery(value as typeof delivery)}
                items={[
                  { value: "always", label: "每次交付" },
                  { value: "conditional", label: "满足条件才通知" },
                ]}
              />
            </SettingRow>
            <SettingRow
              title="执行期限"
              description="分钟，不含等待回答或审批的时间"
            >
              <input
                className="field-control"
                aria-label="执行期限"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                required
              />
            </SettingRow>
          </div>
          {delivery === "conditional" && (
            <TextField
              label="通知条件"
              value={condition}
              onValueChange={setCondition}
              required
              maxLength={WORK_TEXT_LENGTH}
            />
          )}
        </section>
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
      </fieldset>
    </form>
  );
}
