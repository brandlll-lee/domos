import {
  BotAvatar,
  characterImages,
  prepareBotAvatar,
  retryAvatarImages,
  useAvatarImages,
} from "@domos/ui/avatar";
import type { CharacterMedia } from "@domos/ui/characters";
import {
  characterColors,
  characterIdentity,
  characterNames,
  characterSeed,
} from "@domos/ui/characters";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { Tabs } from "@domos/ui/tabs";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { useEffect, useState } from "react";
import { useCharacters } from "./character-state.ts";
import "./profile.css";

const hexColor = /^#[0-9a-f]{6}$/i;
const shapes = Object.keys(characterNames) as (keyof typeof characterNames)[];
const pickerImages = [
  ...new Set(shapes.flatMap((shape) => characterImages(shape, true))),
];

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
  const [hex, setHex] = useState(identity.color);
  useEffect(() => setHex(identity.color), [identity.color]);
  const { store, data, error, loading: pending } = useCharacters(botId);
  const selected = data?.find((item) => item.id === assetId);
  const source = assetId === null ? undefined : (media ?? selected?.media);
  const picker = useAvatarImages(pickerImages);
  const [preview, setPreview] = useState({ value, source });
  useEffect(() => {
    let current = true;
    void prepareBotAvatar(value, source, false).then((ready) => {
      if (current && ready) setPreview({ value, source });
    });
    return () => {
      current = false;
    };
  }, [value, source]);
  return (
    <fieldset className="bot-fields avatar-editor">
      <legend>角色与主题</legend>
      <div className="avatar-preview">
        <BotAvatar seed={preview.value} media={preview.source} size="large" />
      </div>
      <Tabs.Root defaultValue={assetId ? "saved" : "built-in"}>
        <Tabs.List className="workspace-tabs" aria-label="角色来源">
          <Tabs.Tab className="navigation-tab" value="built-in">
            内置角色
          </Tabs.Tab>
          <Tabs.Tab className="navigation-tab" value="saved">
            我的角色
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="saved">
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
                <BotAvatar seed={value} media={item.media} size="medium" />
              </Button>
            ))}
          </fieldset>
          {pending && !data && <Loading label="正在读取角色" inline />}
          {!!error && (
            <InlineNotice>
              <span>角色读取失败。</span>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void store.load(true).catch(() => {})}
              >
                重试
              </Button>
            </InlineNotice>
          )}
          {!pending && !error && !data?.length && (
            <p>保存的角色会显示在这里。</p>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="built-in">
          {picker === "loading" && <Loading label="正在准备内置角色" inline />}
          {picker === "failed" && (
            <InlineNotice>
              <span>内置角色读取失败。</span>
              <Button
                type="button"
                variant="ghost"
                onClick={() => retryAvatarImages(pickerImages)}
              >
                重试
              </Button>
            </InlineNotice>
          )}
          <fieldset className="avatar-shapes" aria-label="外形">
            {picker === "ready" &&
              shapes.map((shape) => (
                <Button
                  type="button"
                  key={shape}
                  variant="ghost"
                  aria-label={`外形：${characterNames[shape]}`}
                  title={characterNames[shape]}
                  aria-pressed={!source && identity.shape === shape}
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
          <Button
            type="button"
            variant="ghost"
            size="small"
            onClick={() => {
              onAssetChange?.(null);
              onChange(characterSeed(undefined, identity.color));
            }}
          >
            <ArrowsClockwiseIcon size={16} />
            换个形象
          </Button>
        </Tabs.Panel>
      </Tabs.Root>
      <fieldset className="avatar-colors" aria-label="主题色">
        <legend>主题色</legend>
        <div className="avatar-color-grid">
          {characterColors.map(({ name, color }) => (
            <Button
              type="button"
              key={color}
              variant="ghost"
              aria-label={`颜色：${name}`}
              title={name}
              aria-pressed={identity.color === color}
              style={{
                backgroundColor: color,
                color: `contrast-color(${color})`,
              }}
              onClick={() => {
                setHex(color);
                onChange(characterSeed(identity.shape, color));
              }}
            >
              {identity.color === color && <CheckIcon size={16} />}
            </Button>
          ))}
        </div>
        <div className="avatar-color-custom">
          <label className="avatar-color-picker">
            自定义颜色
            <span style={{ backgroundColor: identity.color }} />
            <input
              type="color"
              aria-label="自定义颜色"
              value={identity.color}
              onChange={(event) => {
                setHex(event.target.value);
                onChange(characterSeed(identity.shape, event.target.value));
              }}
            />
          </label>
          <TextField
            label="HEX"
            value={hex}
            required
            pattern="#[0-9A-Fa-f]{6}"
            maxLength={7}
            autoComplete="off"
            error={
              hexColor.test(hex) ? undefined : "请输入 # 和六位十六进制颜色"
            }
            onValueChange={(next) => {
              setHex(next);
              if (hexColor.test(next))
                onChange(characterSeed(identity.shape, next.toLowerCase()));
            }}
          />
        </div>
      </fieldset>
    </fieldset>
  );
}
