import { BotAvatar } from "@domos/ui/avatar";
import {
  type CharacterMedia,
  characterIdentity,
  characterNames,
  characterSeed,
} from "@domos/ui/characters";
import { ColorPicker } from "@domos/ui/color-picker";
import { Tabs } from "@domos/ui/tabs";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useErrorNotice } from "../notices.tsx";
import { userError } from "../user-error.ts";
import { useCharacters } from "./character-state.ts";
import "./profile.css";

const shapes = Object.keys(characterNames) as (keyof typeof characterNames)[];

export function useCharacterMedia(
  botId: number | undefined,
  assetId: string | null | undefined,
  media?: CharacterMedia,
) {
  const { store, data, error } = useCharacters(botId);
  useErrorNotice(error ? userError(error, "角色读取失败。") : undefined, () =>
    store.load(true).then(
      () => {},
      () => {},
    ),
  );
  const selected = data?.find((item) => item.id === assetId);
  const source = useMemo(() => {
    const chosen = assetId === null ? undefined : (media ?? selected?.media);
    return chosen && selected?.media.thumbnail
      ? { ...chosen, thumbnail: selected.media.thumbnail }
      : chosen;
  }, [assetId, media, selected]);
  return { data, source };
}

export function IdentityPreview({
  name,
  avatar,
  media,
  onEdit,
}: {
  name: string;
  avatar: string;
  media?: CharacterMedia;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      className="profile-identity"
      aria-label="编辑外观"
      onClick={onEdit}
    >
      <span className="profile-identity-avatar">
        <BotAvatar seed={avatar} media={media} size="large" interactive />
      </span>
      <span className="profile-identity-copy">
        <strong>{name || "新伙伴"}</strong>
        <span>
          编辑外观 <span aria-hidden="true">›</span>
        </span>
      </span>
    </button>
  );
}

const ShapeGallery = memo(function ShapeGallery({
  value,
  custom,
  onChange,
}: {
  value: string;
  custom: boolean;
  onChange: (value: string) => void;
}) {
  const identity = characterIdentity(value);
  return (
    <fieldset className="profile-shapes" aria-label="内置角色">
      {shapes.map((shape) => (
        <button
          type="button"
          className="profile-shape"
          key={shape}
          aria-label={`外形：${characterNames[shape]}`}
          title={characterNames[shape]}
          aria-pressed={!custom && identity.shape === shape}
          onClick={() => onChange(characterSeed(shape, identity.color))}
        >
          <BotAvatar
            seed={characterSeed(shape, identity.color)}
            size="medium"
          />
        </button>
      ))}
    </fieldset>
  );
});

export function AvatarEditor({
  value,
  assetId,
  source,
  characters,
  onAssetChange,
  onChange,
  onEquipment,
  colors,
  onColorsChange,
}: {
  value: string;
  assetId?: string | null;
  source?: CharacterMedia;
  characters: ReturnType<typeof useCharacterMedia>["data"];
  onAssetChange: (id: string | null) => void;
  onChange: (value: string) => void;
  onEquipment: () => void;
  colors: string[];
  onColorsChange: (colors: string[]) => void;
}) {
  const identity = characterIdentity(value);
  const [preview, setPreview] = useState(identity.color);
  const selectShape = useCallback(
    (next: string) => {
      onAssetChange(null);
      onChange(next);
    },
    [onAssetChange, onChange],
  );
  useEffect(() => setPreview(identity.color), [identity.color]);
  return (
    <div className="avatar-editor">
      <div className="profile-stage avatar-preview">
        <BotAvatar
          seed={characterSeed(identity.shape, preview)}
          media={source}
          size="large"
          interactive
        />
      </div>
      <Tabs.Root defaultValue={assetId ? "saved" : "builtin"}>
        <Tabs.List
          className="navigation-tabs profile-source-tabs"
          aria-label="角色来源"
        >
          <Tabs.Tab className="navigation-tab" value="builtin">
            内置角色
          </Tabs.Tab>
          <Tabs.Tab className="navigation-tab" value="saved">
            我的角色
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="builtin">
          <ShapeGallery
            value={value}
            custom={!!source}
            onChange={selectShape}
          />
        </Tabs.Panel>
        <Tabs.Panel value="saved">
          <div className="profile-shapes">
            {characters?.map((item) => (
              <button
                type="button"
                key={item.id}
                className="profile-shape"
                aria-label={`角色：${item.name}`}
                title={item.name}
                aria-pressed={assetId === item.id}
                onClick={() => onAssetChange(item.id)}
              >
                <BotAvatar seed={value} media={item.media} size="medium" />
              </button>
            ))}
          </div>
          {!characters?.length && (
            <p className="detail-note">
              还没有保存的角色。聊天中创建的角色会显示在这里。
            </p>
          )}
        </Tabs.Panel>
      </Tabs.Root>
      <div className="profile-tone-section">
        <ColorPicker
          value={identity.color}
          colors={colors}
          onColorsChange={onColorsChange}
          onPreview={setPreview}
          onChange={(color) => onChange(characterSeed(identity.shape, color))}
        />
        <section className="profile-message-preview" aria-label="主题效果预览">
          <span>为下一个好想法，留一点时间。</span>
          <span
            className="profile-message-bubble"
            style={{ background: preview, color: `contrast-color(${preview})` }}
          >
            我们开始吧
          </span>
        </section>
        {source && (
          <button
            type="button"
            className="profile-navigation"
            onClick={onEquipment}
          >
            <span>调整耳机与电脑</span>
            <span aria-hidden="true">›</span>
          </button>
        )}
      </div>
    </div>
  );
}
