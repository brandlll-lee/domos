import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { Button } from "@domos/ui/controls";
import { ConfirmButton } from "@domos/ui/dialog";
import { Checkbox, TextField } from "@domos/ui/field";
import { ChoicePicker } from "@domos/ui/picker";
import { useState } from "react";
import { client } from "../../../client.ts";
import { RoutineSchedule, routineTimeLabel } from "./routine-schedule.tsx";
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

export function RoutinesPanel({
  botId,
  data,
  skills,
  action,
}: {
  botId: number;
  data: WorkData["routines"];
  skills: WorkData["skills"];
  action: WorkAction;
}) {
  const [editing, setEditing] = useState<Routine | null>(null);
  return (
    <div className="detail-stack">
      <p className="detail-note">
        Domos 服务运行时，Bot
        会按计划工作。新任务保存后需手动启用。试跑会真实执行。
      </p>
      <RoutineEditor
        key={editing?.id ?? "new"}
        botId={botId}
        routine={editing}
        skills={skills}
        action={action}
        onSaved={() => setEditing(null)}
      />
      {editing && (
        <Button
          variant="secondary"
          size="small"
          onClick={() => setEditing(null)}
        >
          取消编辑
        </Button>
      )}
      <ul className="detail-list">
        {data.items.map((routine) => (
          <li key={routine.id}>
            <strong>{routine.title}</strong>
            <p className="detail-text">{routine.instructions}</p>
            <p className="detail-note">
              {routine.enabled ? "已启用" : "已暂停"} ·{" "}
              {routine.schedule.type === "once"
                ? new Date(routine.schedule.at).toLocaleString()
                : routineTimeLabel(routine.schedule.expression)}{" "}
              · {routine.schedule.timeZone}
            </p>
            {routine.nextAt && (
              <p className="detail-note">
                下次：{new Date(routine.nextAt).toLocaleString()}
              </p>
            )}
            <div className="detail-actions">
              <Button
                variant="secondary"
                size="small"
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    ["routines.enable", routine.id, routine.revision],
                    (requestId) =>
                      client.work.routines.enable({
                        botId,
                        id: routine.id,
                        enabled: !routine.enabled,
                        revision: routine.revision,
                        requestId,
                      }),
                  )
                }
              >
                {routine.enabled ? "暂停" : "启用"}
              </Button>
              <Button
                variant="ghost"
                size="small"
                disabled={action.busy}
                onClick={() =>
                  void action.run(["routines.test", routine.id], (requestId) =>
                    client.work.routines.test({
                      botId,
                      id: routine.id,
                      requestId,
                    }),
                  )
                }
              >
                试跑
              </Button>
              <Button
                variant="ghost"
                size="small"
                disabled={action.busy}
                onClick={() => setEditing(routine)}
              >
                编辑
              </Button>
              <ConfirmButton
                title="删除这个定时任务？"
                description="已开始的工作仍会完成。"
                disabled={action.busy}
                onConfirm={() => {
                  void action.run(
                    ["routines.delete", routine.id, routine.revision],
                    () =>
                      client.work.routines.delete({
                        botId,
                        id: routine.id,
                        revision: routine.revision,
                      }),
                  );
                }}
              >
                删除
              </ConfirmButton>
            </div>
          </li>
        ))}
      </ul>
      <h3>运行记录</h3>
      <ul className="detail-list">
        {[...data.runs].reverse().map((run) => (
          <li key={run.id}>
            <strong>{run.title}</strong>
            <p>
              {run.mode === "test" ? "试跑" : "定时"} · {runLabels[run.status]}
            </p>
            <p className="detail-note">
              计划：{new Date(run.scheduledAt).toLocaleString()}；触发：
              {new Date(run.firedAt).toLocaleString()}
            </p>
            {run.coalesced && (
              <p className="detail-note">
                已将停机期间错过的周期合并为本次执行。
              </p>
            )}
            {run.error && <p role="status">{run.error}</p>}
            {run.status === "done" && (
              <p className="detail-note">结果已发回此Bot的聊天。</p>
            )}
          </li>
        ))}
      </ul>
    </div>
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
  const [id, setId] = useState(() => crypto.randomUUID());
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
      className="bot-form"
      onSubmit={(event) => {
        event.preventDefault();
        const schedule =
          type === "once"
            ? { type, at: new Date(at).toISOString(), timeZone: localZone }
            : { type, expression, timeZone };
        const input = {
          botId,
          id: routine?.id ?? id,
          revision: routine?.revision ?? 0,
          title,
          instructions,
          schedule,
          skillIds,
        };
        void action.run(
          ["routines.save", input],
          (requestId) => client.work.routines.save({ ...input, requestId }),
          () => {
            setId(crypto.randomUUID());
            setTitle("");
            setInstructions("");
            setSkillIds([]);
            onSaved();
          },
        );
      }}
    >
      <fieldset className="bot-fields" disabled={action.busy}>
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
          <Button type="submit" size="small">
            {routine ? "保存并暂停" : "保存为暂停"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
