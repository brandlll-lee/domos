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
import { InlineNotice } from "@domos/ui/message";
import { Tabs } from "@domos/ui/tabs";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
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
  const selected = data?.find((item) => item.id === assetId);
  const source = assetId === null ? undefined : (media ?? selected?.media);
  return (
    <fieldset className="bot-fields avatar-editor">
      <legend>角色与主题</legend>
      <div className="avatar-preview">
        <BotAvatar seed={value} media={source} size="large" />
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
          <fieldset className="avatar-shapes" aria-label="外形">
            {(
              Object.keys(characterNames) as (keyof typeof characterNames)[]
            ).map((shape) => (
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
        {characterColors.map(({ name, color }) => (
          <Button
            type="button"
            key={color}
            variant="ghost"
            aria-label={`颜色：${name}`}
            title={name}
            aria-pressed={identity.color === color}
            onClick={() => onChange(characterSeed(identity.shape, color))}
          >
            <span style={{ backgroundColor: color }} />
          </Button>
        ))}
      </fieldset>
    </fieldset>
  );
}
