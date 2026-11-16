import { BotAvatar } from "@domos/ui/avatar";
import type { CharacterMedia } from "@domos/ui/characters";
import {
  characterColors,
  characterIdentity,
  characterNames,
  characterSeed,
} from "@domos/ui/characters";
import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { Popover } from "@domos/ui/popover";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { useState } from "react";
import { useCharacters } from "./character-state.ts";
import "./profile.css";

export function AvatarEditor({
  value,
  botId,
  assetId,
  onAssetChange,
  media,
  onChange,
}: {
  value: string;
  botId?: number;
  assetId?: string | null;
  media?: CharacterMedia;
  onAssetChange?: (id: string | null) => void;
  onChange: (value: string) => void;
}) {
  const identity = characterIdentity(value);
  const { store, data, error, loading: pending } = useCharacters(botId);
  const [tab, setTab] = useState<"built-in" | "saved">(
    assetId ? "saved" : "built-in",
  );
  const selected = data?.find((item) => item.id === assetId);
  const source = assetId === null ? undefined : (selected?.media ?? media);
  return (
    <div className="avatar-editor">
      <BotAvatar seed={value} media={source} size="large" />
      <Popover.Root
        onOpenChange={(open) => {
          if (open) void store.load(true).catch(() => {});
        }}
      >
        <Popover.Trigger
          render={
            <Button
              type="button"
              variant="secondary"
              size="icon-small"
              aria-label="选择头像"
              title="选择头像"
            />
          }
        >
          <PencilSimpleIcon size={16} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className="picker-positioner"
            sideOffset={8}
            collisionPadding={12}
            align="start"
          >
            <Popover.Popup className="picker-popup avatar-picker">
              <Popover.Title className="sr-only">头像外观</Popover.Title>
              <div className="avatar-categories">
                <Button
                  type="button"
                  variant="ghost"
                  aria-pressed={tab === "built-in"}
                  onClick={() => setTab("built-in")}
                >
                  内置角色
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-pressed={tab === "saved"}
                  onClick={() => setTab("saved")}
                >
                  我的角色
                </Button>
              </div>
              {tab === "saved" && (
                <>
                  <fieldset className="avatar-shapes" aria-label="我的角色">
                    {data?.map((item) => (
                      <Button
                        type="button"
                        key={item.id}
                        variant="ghost"
                        aria-label={`角色：${item.name}`}
                        aria-pressed={assetId === item.id}
                        onClick={() => onAssetChange?.(item.id)}
                      >
                        <BotAvatar seed={value} media={item.media} />
                      </Button>
                    ))}
                  </fieldset>
                  {pending && !data && <Loading label="正在读取角色" inline />}
                  {error && <p role="alert">角色读取失败，请重新打开重试。</p>}
                  {!pending && !error && !data?.length && (
                    <p>保存的角色会显示在这里。</p>
                  )}
                </>
              )}
              {tab === "built-in" && (
                <fieldset className="avatar-shapes" aria-label="外形">
                  {(
                    Object.keys(
                      characterNames,
                    ) as (keyof typeof characterNames)[]
                  ).map((shape) => (
                    <Button
                      key={shape}
                      variant="ghost"
                      aria-label={`外形：${characterNames[shape]}`}
                      title={characterNames[shape]}
                      aria-pressed={identity.shape === shape}
                      onClick={() => {
                        onAssetChange?.(null);
                        onChange(characterSeed(shape, identity.color));
                      }}
                    >
                      <BotAvatar
                        seed={characterSeed(shape, identity.color)}
                        size="medium"
                      />
                    </Button>
                  ))}
                </fieldset>
              )}
              <fieldset className="avatar-colors" aria-label="主题色">
                {characterColors.map(({ name, color }) => (
                  <Button
                    key={color}
                    variant="ghost"
                    aria-label={`颜色：${name}`}
                    title={name}
                    aria-pressed={identity.color === color}
                    onClick={() =>
                      onChange(characterSeed(identity.shape, color))
                    }
                  >
                    <span style={{ backgroundColor: color }} />
                  </Button>
                ))}
              </fieldset>
              <Button
                type="button"
                variant="ghost"
                size="small"
                aria-label="换个形象"
                onClick={() => {
                  onAssetChange?.(null);
                  onChange(characterSeed(undefined, identity.color));
                }}
              >
                <ArrowsClockwiseIcon size={16} />
              </Button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
