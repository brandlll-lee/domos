import { BotAvatar } from "@domos/ui/avatar";
import type { CharacterMedia } from "@domos/ui/characters";
import { Button } from "@domos/ui/controls";
import { Tabs } from "@domos/ui/tabs";
import { useMemo, useState } from "react";

export function AvatarEquipment({
  avatar,
  source,
  headset,
  computer,
  onChange,
}: {
  avatar: string;
  source: CharacterMedia;
  headset: CharacterMedia["headset"];
  computer: CharacterMedia["computer"];
  onChange: (
    field: "headset" | "computer",
    value: CharacterMedia["headset"],
  ) => void;
}) {
  const [selected, setSelected] = useState<"headset" | "computer">("headset");
  const media = useMemo(
    () => ({ ...source, headset, computer }),
    [source, headset, computer],
  );
  return (
    <>
      <div className="profile-stage profile-equipment-stage">
        <BotAvatar
          seed={avatar}
          media={media}
          size="large"
          interactive
          work={{ id: "equipment-preview", working: false }}
        />
      </div>
      <Tabs.Root
        value={selected}
        onValueChange={(value) => setSelected(value as typeof selected)}
      >
        <Tabs.List
          className="navigation-tabs profile-source-tabs"
          aria-label="选择装备"
        >
          <Tabs.Tab className="navigation-tab" value="headset">
            耳机
          </Tabs.Tab>
          <Tabs.Tab className="navigation-tab" value="computer">
            电脑
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>
      <div className="profile-equipment-controls">
        {(
          [
            ["x", "水平位置", 0, 100, 1],
            ["y", "垂直位置", 0, 100, 1],
            ["scale", "大小", 0.1, 2, 0.01],
          ] as const
        ).map(([field, label, min, max, step]) => {
          const change = (value: string) => {
            if (!value.trim()) return;
            const next = Number(value);
            if (Number.isFinite(next))
              onChange(selected, {
                ...media[selected],
                [field]: Math.min(max, Math.max(min, next)),
              });
          };
          return (
            <label className="profile-range" key={field}>
              <span>{label}</span>
              <input
                type="range"
                aria-label={`${label}滑块`}
                min={min}
                max={max}
                step={step}
                value={media[selected][field]}
                onChange={(event) => change(event.target.value)}
              />
              <input
                type="number"
                aria-label={`${label}数值`}
                min={min}
                max={max}
                step={step}
                value={media[selected][field]}
                onChange={(event) => change(event.target.value)}
              />
            </label>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        className="profile-equipment-reset"
        onClick={() => onChange(selected, source[selected])}
      >
        还原{selected === "headset" ? "耳机" : "电脑"}位置
      </Button>
    </>
  );
}
