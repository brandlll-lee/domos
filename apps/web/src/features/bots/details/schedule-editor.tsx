import { SCHEDULE_EXPRESSION_LENGTH } from "@domos/agent/work/limits";
import {
  days,
  expressionPattern,
  routineTimeLabel,
} from "@domos/agent/work/schedule-label";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { ChoicePicker, SearchPicker } from "@domos/ui/picker";
import { Popover } from "@domos/ui/popover";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { useState } from "react";

export type Schedule =
  | { type: "cron"; expression: string; timeZone: string }
  | { type: "once"; at: string; timeZone: string };
const numbers = (count: number) =>
  Array.from({ length: count }, (_, n) => ({
    value: String(n),
    label: String(n).padStart(2, "0"),
  }));
const hours = numbers(24);
const minutes = numbers(60);
const zones = Intl.supportedValuesOf("timeZone");
export function scheduleSummary(schedule: Schedule) {
  return schedule.type === "cron"
    ? routineTimeLabel(schedule.expression)
    : new Date(schedule.at).toLocaleString("zh-CN", {
        timeZone: schedule.timeZone,
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
}

function Calendar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(`${value}T12:00:00`));
  const year = month.getFullYear();
  const index = month.getMonth();
  const count = new Date(year, index + 1, 0).getDate();
  const offset = (new Date(year, index, 1).getDay() + 6) % 7;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={<Button variant="secondary" className="schedule-date" />}
      >
        <CalendarBlankIcon />
        {value.replaceAll("-", " / ")}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="popover-positioner"
          sideOffset={8}
          collisionPadding={16}
        >
          <Popover.Popup className="popover-surface schedule-calendar">
            <div className="schedule-calendar-head">
              <Button
                variant="ghost"
                size="icon-small"
                aria-label="上个月"
                onClick={() => setMonth(new Date(year, index - 1, 1))}
              >
                ‹
              </Button>
              <Popover.Title>
                {year}年{index + 1}月
              </Popover.Title>
              <Button
                variant="ghost"
                size="icon-small"
                aria-label="下个月"
                onClick={() => setMonth(new Date(year, index + 1, 1))}
              >
                ›
              </Button>
            </div>
            <div className="schedule-calendar-days">
              {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="schedule-calendar-days">
              {[
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
              ]
                .slice(0, offset)
                .map((day) => (
                  <span key={day} />
                ))}
              {Array.from({ length: count }, (_, index) => {
                const date = `${year}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
                return (
                  <button
                    type="button"
                    key={date}
                    aria-label={date}
                    aria-pressed={date === value}
                    onClick={() => {
                      onChange(date);
                      setOpen(false);
                    }}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ScheduleEditor({
  value,
  onChange,
}: {
  value: Schedule;
  onChange: (schedule: Schedule) => void;
}) {
  const match =
    value.type === "cron" ? expressionPattern.exec(value.expression) : null;
  const initial =
    value.type === "once"
      ? new Intl.DateTimeFormat("sv-SE", {
          timeZone: value.timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
          .format(new Date(value.at))
          .split(" ")
      : null;
  const [date, setDate] = useState(() => {
    if (initial?.[0]) return initial[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  });
  const [hour, setHour] = useState(
    String(Number(initial?.[1]?.split(":")[0] ?? match?.[2] ?? 8)),
  );
  const [minute, setMinute] = useState(
    String(Number(initial?.[1]?.split(":")[1] ?? match?.[1] ?? 0)),
  );
  const [day, setDay] = useState(
    match?.[3] && /^[0-6]$/.test(match[3]) ? match[3] : "1",
  );
  const [frequency, setFrequency] = useState(
    value.type === "once"
      ? "once"
      : !match
        ? "custom"
        : match[3] === "*"
          ? "daily"
          : match[3] === "1-5"
            ? "weekdays"
            : "weekly",
  );
  function update(next: {
    frequency?: string;
    hour?: string;
    minute?: string;
    day?: string;
    date?: string;
    timeZone?: string;
  }) {
    const freq = next.frequency ?? frequency;
    const h = next.hour ?? hour;
    const m = next.minute ?? minute;
    const d = next.day ?? day;
    const selectedDate = next.date ?? date;
    const timeZone =
      freq === "once"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : (next.timeZone ?? value.timeZone);
    setFrequency(freq);
    setHour(h);
    setMinute(m);
    setDay(d);
    setDate(selectedDate);
    if (freq === "once") {
      const at = new Date(
        `${selectedDate}T${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`,
      );
      onChange({ type: "once", at: at.toISOString(), timeZone });
    } else
      onChange({
        type: "cron",
        expression:
          freq === "custom" && value.type === "cron"
            ? value.expression
            : `${m} ${h} * * ${freq === "weekly" ? d : freq === "weekdays" ? "1-5" : "*"}`,
        timeZone,
      });
  }
  return (
    <div className="schedule-editor">
      <div className="management-input">
        <span>执行频率</span>
        <ChoicePicker
          label="执行频率"
          value={frequency}
          onValueChange={(frequency) => update({ frequency })}
          items={[
            { value: "daily", label: "每天" },
            { value: "weekdays", label: "工作日" },
            { value: "weekly", label: "每周" },
            { value: "once", label: "执行一次" },
            { value: "custom", label: "自定义规则" },
          ]}
        />
      </div>
      {frequency === "weekly" && (
        <div className="management-input">
          <span>星期</span>
          <ChoicePicker
            label="星期"
            value={day}
            onValueChange={(day) => update({ day })}
            items={days.map((label, index) => ({
              value: String(index),
              label,
            }))}
          />
        </div>
      )}
      {frequency === "once" && (
        <div className="management-input">
          <span>日期</span>
          <Calendar value={date} onChange={(date) => update({ date })} />
        </div>
      )}
      {frequency !== "custom" ? (
        <div className="management-input">
          <span>执行时间</span>
          <div className="schedule-clock">
            <ChoicePicker
              label="小时"
              value={hour}
              onValueChange={(hour) => update({ hour })}
              items={hours}
            />
            <span>:</span>
            <ChoicePicker
              label="分钟"
              value={minute}
              onValueChange={(minute) => update({ minute })}
              items={minutes}
            />
          </div>
        </div>
      ) : (
        <TextField
          label="时间规则"
          required
          maxLength={SCHEDULE_EXPRESSION_LENGTH}
          value={value.type === "cron" ? value.expression : ""}
          onValueChange={(expression) =>
            onChange({ type: "cron", expression, timeZone: value.timeZone })
          }
        />
      )}
      <div className="management-input">
        <span>{frequency === "once" ? "本机时区" : "时区"}</span>
        {frequency === "once" ? (
          <span className="management-muted">{value.timeZone}</span>
        ) : (
          <SearchPicker
            label="时区"
            value={value.timeZone}
            onValueChange={(timeZone) => update({ timeZone })}
            items={[...new Set([value.timeZone, ...zones])].map((value) => ({
              value,
              label: value,
            }))}
            placeholder="选择时区"
            searchLabel="搜索时区"
            emptyLabel="没有匹配时区"
          />
        )}
      </div>
      <p className="schedule-preview">
        <CalendarBlankIcon />
        {scheduleSummary(value)}
        <span>{value.timeZone}</span>
      </p>
    </div>
  );
}
