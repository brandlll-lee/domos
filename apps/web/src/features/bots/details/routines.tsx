import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { Button, Switch } from "@domos/ui/controls";
import { ConfirmDialog } from "@domos/ui/dialog";
import { Checkbox, TextField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { PanelHeader } from "@domos/ui/panel";
import { ChoicePicker } from "@domos/ui/picker";
import { ScrollArea } from "@domos/ui/scroll-area";
import { SettingRow } from "@domos/ui/setting-row";
import { Tabs } from "@domos/ui/tabs";
import { type ComponentProps, useLayoutEffect, useRef, useState } from "react";
import { client } from "../../../client.ts";
import type { useChat } from "../../chat/use-chat.ts";
import { WorkPanel } from "../../chat/work.tsx";
import {
  type Schedule,
  ScheduleEditor,
  scheduleSummary,
} from "./schedule-editor.tsx";
import type { PanelEditor } from "./types.ts";
import type { WorkAction, WorkData } from "./use-bot-work.ts";
import "./routines.css";

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

export function RoutinesPanel({
  botId,
  data,
  skills,
  action,
  editor,
  onEditorChange,
  chat,
  author,
  onDetailChange,
  onClose,
  onBack,
}: {
  chat: ReturnType<typeof useChat>;
  botId: number;
  data: WorkData["routines"];
  skills: WorkData["skills"];
  action: WorkAction;
  editor: Extract<PanelEditor, { view: "routines" }> | null;
  onEditorChange: (editor: PanelEditor | null) => void;
  author: ComponentProps<typeof WorkPanel>["author"];
  onDetailChange: (open: boolean) => void;
  onClose: () => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState("tasks");
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedRun, setSelectedRun] = useState<string>();
  const [notice, setNotice] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const source = useRef<HTMLButtonElement>(null);
  const reading = useRef(0);
  useLayoutEffect(() => {
    if (selectedRun || !source.current) return;
    if (viewport.current) viewport.current.scrollTop = reading.current;
    source.current.focus({ preventScroll: true });
  }, [selectedRun]);
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const runs = [...data.runs].reverse();
  const selected = runs.find((run) => run.turnId === selectedRun);
  const routine = data.items.find((item) => item.id === selectedId);
  const edit = (routine: Routine | null) => {
    action.clear();
    onEditorChange({ view: "routines", routine, token: crypto.randomUUID() });
  };
  const trial = (routine: Routine) =>
    void action.run(
      ["routines.test", routine.id],
      (requestId) =>
        client.work.routines.test({ botId, id: routine.id, requestId }),
      () => {
        setTab("runs");
        setSelectedId(undefined);
      },
    );
  return (
    <>
      {!selectedRun && (
        <PanelHeader
          title={
            editor
              ? editor.routine
                ? "编辑任务"
                : "新建任务"
              : routine
                ? "任务详情"
                : "定时任务"
          }
          onClose={onClose}
          onBack={() => {
            if (editor) onEditorChange(null);
            else if (routine) setSelectedId(undefined);
            else onBack();
          }}
        />
      )}
      {!editor && !routine && !selectedRun && (
        <div className="routine-toolbar">
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List
              className="navigation-tabs profile-source-tabs"
              aria-label="定时页面"
            >
              <Tabs.Tab className="navigation-tab" value="tasks">
                任务
              </Tabs.Tab>
              <Tabs.Tab className="navigation-tab" value="runs">
                运行记录
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.Root>
          <Button
            size="small"
            onClick={() => edit(null)}
            disabled={action.busy}
          >
            新建任务
          </Button>
        </div>
      )}
      <ScrollArea
        hidden={Boolean(selectedRun)}
        viewportRef={viewport}
        className="detail-scroll"
        viewportClassName="detail-content"
      >
        <section className="detail-page" aria-label="定时任务">
          {notice && (
            <p className="detail-note" role="status">
              {notice}
            </p>
          )}
          {editor ? (
            <RoutineEditor
              key={editor.token}
              botId={botId}
              routine={editor.routine}
              skills={skills}
              action={action}
              onSaved={() => {
                onEditorChange(null);
                setNotice("已保存，任务处于暂停状态。");
              }}
            />
          ) : routine ? (
            <div className="routine-detail">
              <h3>{routine.title}</h3>
              <p className="routine-instructions">{routine.instructions}</p>
              <SettingRow title="执行安排">
                <span>
                  {scheduleSummary(routine.schedule)} ·{" "}
                  {routine.schedule.timeZone}
                </span>
              </SettingRow>
              <SettingRow title="通知">
                <span>
                  {routine.delivery === "conditional"
                    ? routine.condition
                    : "每次发送结果"}
                </span>
              </SettingRow>
              <p className="detail-note">
                {routine.enabled ? "已启用" : "已暂停"} · 试跑会立即执行任务。
              </p>
              <div className="form-actions">
                <Button
                  variant="secondary"
                  disabled={action.busy}
                  onClick={() => edit(routine)}
                >
                  编辑
                </Button>
                <Button disabled={action.busy} onClick={() => trial(routine)}>
                  试跑一次
                </Button>
                <ActionMenu
                  label={`${routine.title}的操作`}
                  disabled={action.busy}
                  items={[
                    {
                      label: "删除",
                      tone: "danger",
                      onSelect: () => setDeleting(routine),
                    },
                  ]}
                />
              </div>
            </div>
          ) : tab === "tasks" ? (
            data.items.length ? (
              <ul className="routine-list">
                {data.items.map((routine) => (
                  <li key={routine.id} className="routine-task">
                    <button
                      type="button"
                      className="routine-task-open"
                      onClick={() => setSelectedId(routine.id)}
                    >
                      <strong>{routine.title}</strong>
                      <span>
                        {scheduleSummary(routine.schedule)} ·{" "}
                        {routine.enabled ? "已启用" : "已暂停"}
                      </span>
                      {routine.nextAt && (
                        <small>
                          下次：{new Date(routine.nextAt).toLocaleString()}
                        </small>
                      )}
                    </button>
                    <Switch
                      label={`启用 ${routine.title}`}
                      checked={routine.enabled}
                      disabled={action.busy}
                      onCheckedChange={(enabled) =>
                        void action.run(
                          [
                            "routines.enable",
                            routine.id,
                            routine.revision,
                            enabled,
                          ],
                          (requestId) =>
                            client.work.routines.enable({
                              botId,
                              id: routine.id,
                              enabled,
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
                        { label: "试跑", onSelect: () => trial(routine) },
                        { label: "编辑", onSelect: () => edit(routine) },
                        {
                          label: "删除",
                          tone: "danger",
                          onSelect: () => setDeleting(routine),
                        },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="detail-empty">暂无定时任务</p>
            )
          ) : runs.length ? (
            <ul className="run-list">
              {runs.map((run) => (
                <li key={run.id} data-state={run.status}>
                  <Button
                    variant="ghost"
                    className="routine-run"
                    disabled={!run.turnId}
                    aria-label={`查看工作记录：${run.title}`}
                    onClick={(event) => {
                      source.current = event.currentTarget;
                      reading.current = viewport.current?.scrollTop ?? 0;
                      setSelectedRun(run.turnId);
                    }}
                  >
                    <span className="routine-run-copy">
                      <strong>{run.title}</strong>
                      <span className="item-note">
                        {new Date(run.firedAt).toLocaleString()}
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
            <p className="detail-empty">还没有运行记录。</p>
          )}
        </section>
      </ScrollArea>
      {editor && (
        <footer className="detail-footer form-actions">
          <Button
            variant="ghost"
            disabled={action.busy}
            onClick={() => onEditorChange(null)}
          >
            取消
          </Button>
          <Button type="submit" form={`routine-${botId}`} pending={action.busy}>
            保存并暂停
          </Button>
        </footer>
      )}
      <ConfirmDialog
        open={!!deleting}
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
                setSelectedId(undefined);
                onEditorChange(null);
              },
            );
        }}
      />
      {selectedRun && (
        <WorkPanel
          {...chat}
          author={author}
          onDetailChange={onDetailChange}
          onClose={onClose}
          botId={botId}
          selectedRun={selectedRun}
          onRunClose={() => setSelectedRun(undefined)}
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
    </>
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
  const [schedule, setSchedule] = useState<Schedule>(
    routine?.schedule ?? {
      type: "cron",
      expression: "0 8 * * *",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
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
        <ScheduleEditor value={schedule} onChange={setSchedule} />
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
