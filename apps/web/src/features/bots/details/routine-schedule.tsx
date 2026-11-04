import { days, expressionPattern } from "@domos/agent/work/schedule-label";

export { routineTimeLabel } from "@domos/agent/work/schedule-label";

import {
  SCHEDULE_EXPRESSION_LENGTH,
  TIME_ZONE_LENGTH,
} from "@domos/agent/work/limits";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { useState } from "react";

const frequencies = [
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日" },
  { value: "weekly", label: "每周" },
  { value: "custom", label: "自定义" },
];

export function RoutineSchedule({
  expression,
  onExpressionChange,
  timeZone,
  onTimeZoneChange,
}: {
  expression: string;
  onExpressionChange: (value: string) => void;
  timeZone: string;
  onTimeZoneChange: (value: string) => void;
}) {
  const match = expressionPattern.exec(expression);
  const [, minute = "0", hour = "9", weekday = "*"] = match ?? [];
  const [frequency, setFrequency] = useState(
    !match
      ? "custom"
      : weekday === "*"
        ? "daily"
        : weekday === "1-5"
          ? "weekdays"
          : "weekly",
  );
  const [time, setTime] = useState(
    `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`,
  );
  const [day, setDay] = useState(/^[0-6]$/.test(weekday) ? weekday : "1");
  const [zoneOpen, setZoneOpen] = useState(false);
  function update(nextFrequency: string, nextTime: string, nextDay: string) {
    setFrequency(nextFrequency);
    setTime(nextTime);
    setDay(nextDay);
    if (nextFrequency === "custom" || !nextTime) return;
    const [hour, minute] = nextTime.split(":").map(Number);
    const weekday =
      nextFrequency === "daily"
        ? "*"
        : nextFrequency === "weekdays"
          ? "1-5"
          : nextDay;
    onExpressionChange(`${minute} ${hour} * * ${weekday}`);
  }
  return (
    <>
      <SettingRow title="重复频率">
        <ChoicePicker
          label="重复频率"
          items={frequencies}
          value={frequency}
          onValueChange={(value) => update(value, time, day)}
        />
      </SettingRow>
      {frequency === "weekly" && (
        <SettingRow title="星期">
          <ChoicePicker
            label="星期"
            items={days.map((label, value) => ({
              label,
              value: String(value),
            }))}
            value={day}
            onValueChange={(value) => update(frequency, time, value)}
          />
        </SettingRow>
      )}
      {frequency !== "custom" && (
        <SettingRow title="执行时间">
          <input
            className="field-control"
            aria-label="每天执行时间"
            type="time"
            value={time}
            required
            onChange={(event) => update(frequency, event.target.value, day)}
          />
        </SettingRow>
      )}
      {frequency === "custom" && (
        <TextField
          label="自定义时间规则"
          value={expression}
          onValueChange={onExpressionChange}
          required
          maxLength={SCHEDULE_EXPRESSION_LENGTH}
        />
      )}
      <SettingRow title="时区">
        <Button
          type="button"
          variant="ghost"
          size="small"
          onClick={() => setZoneOpen(true)}
        >
          {timeZone}
        </Button>
      </SettingRow>
      <Dialog
        open={zoneOpen}
        onOpenChange={setZoneOpen}
        title="执行时区"
        description="填写任务使用的时区。"
        footer={<Button onClick={() => setZoneOpen(false)}>完成</Button>}
      >
        <TextField
          label="时区"
          value={timeZone}
          onValueChange={onTimeZoneChange}
          required
          maxLength={TIME_ZONE_LENGTH}
        />
      </Dialog>
    </>
  );
}
