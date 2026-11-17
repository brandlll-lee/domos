import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { client } from "../../../client.ts";
import { useCharacters } from "../character-state.ts";
import { equipmentFields } from "./identity-state.ts";
import {
  type Profile,
  saveBotIdentity,
  useIdentityDraft,
  type WorkAction,
} from "./use-bot-work.ts";

export function AvatarEquipment({
  profile,
  action,
}: {
  profile: Profile;
  action: WorkAction;
}) {
  const draft = useIdentityDraft(profile);
  const { data } = useCharacters(profile.id);
  const { avatar, avatarAssetId } = draft.values.appearance;
  const source =
    avatarAssetId === null
      ? undefined
      : avatarAssetId === profile.avatarAssetId
        ? profile.avatarMedia
        : data?.find((item) => item.id === avatarAssetId)?.media;
  if (!source) return null;
  const media = {
    ...source,
    headset: draft.values.headset ?? source.headset,
    computer: draft.values.computer ?? source.computer,
  };
  const dirty = draft.dirty.some((field) => equipmentFields.includes(field));
  const conflicted = draft.conflicts.some(
    (field) => field === "appearance" || equipmentFields.includes(field),
  );
  return (
    <fieldset className="bot-fields equipment-editor">
      <legend>装备调整</legend>
      <figure className="avatar-preview" aria-label="角色装备预览">
        <BotAvatar
          seed={avatar}
          media={media}
          size="large"
          interactive
          work={{ id: "equipment-preview", working: false }}
        />
      </figure>
      {(
        [
          ["headset", "耳机"],
          ["computer", "电脑"],
        ] as const
      ).map(([equipment, label]) => (
        <fieldset className="equipment-fields" key={equipment}>
          <legend>{label}位置</legend>
          {(
            [
              ["x", "水平"],
              ["y", "垂直"],
              ["scale", "缩放"],
            ] as const
          ).map(([field, title]) => (
            <TextField
              key={field}
              label={`${label}${title}`}
              type="number"
              min={field === "scale" ? 0.1 : 0}
              max={field === "scale" ? 2 : 100}
              step={field === "scale" ? 0.01 : 1}
              value={String(media[equipment][field])}
              onValueChange={(value) => {
                const number = Number(value);
                if (Number.isFinite(number))
                  draft.change(
                    equipment,
                    {
                      ...media[equipment],
                      [field]: Math.max(
                        field === "scale" ? 0.1 : 0,
                        Math.min(field === "scale" ? 2 : 100, number),
                      ),
                    },
                    media[equipment],
                  );
              }}
            />
          ))}
        </fieldset>
      ))}
      <div className="form-actions">
        <Button
          type="button"
          size="small"
          variant="secondary"
          disabled={!dirty || action.busy || conflicted}
          onClick={() => {
            const input = {
              botId: profile.id,
              name: profile.name,
              instructions: profile.instructions,
              avatar,
              avatarAssetId,
              revision: profile.revision,
              headset: media.headset,
              computer: media.computer,
            };
            void action.run(["equipment", input], (requestId) =>
              saveBotIdentity(
                profile.id,
                ["appearance", ...equipmentFields],
                () => client.work.update({ ...input, requestId }),
              ),
            );
          }}
        >
          {avatarAssetId === profile.avatarAssetId
            ? "保存装备位置"
            : "保存角色与装备"}
        </Button>
        <Button
          type="button"
          size="small"
          variant="ghost"
          disabled={action.busy}
          onClick={() => {
            const input = {
              botId: profile.id,
              revision: profile.revision,
              resetAvatar: true,
            };
            void action.run(["reset-avatar", input], (requestId) =>
              saveBotIdentity(
                profile.id,
                ["appearance", ...equipmentFields],
                () => client.work.identity({ ...input, requestId }),
              ),
            );
          }}
        >
          恢复内置角色
        </Button>
      </div>
    </fieldset>
  );
}
