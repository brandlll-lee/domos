import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { SettingRow } from "@domos/ui/setting-row";
import { client } from "../../../client.ts";
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
  if (!profile.avatarMedia) return null;
  const media = {
    ...profile.avatarMedia,
    headset: draft.values.headset ?? profile.avatarMedia.headset,
    computer: draft.values.computer ?? profile.avatarMedia.computer,
  };
  const dirty = draft.dirty.some((field) => equipmentFields.includes(field));
  const conflicted = draft.conflicts.some((field) =>
    equipmentFields.includes(field),
  );
  return (
    <>
      <SettingRow title="角色装备预览">
        <BotAvatar
          seed={profile.avatar}
          media={media}
          size="large"
          interactive
          work={{ id: "equipment-preview", working: false }}
        />
      </SettingRow>
      {(
        [
          ["headset", "耳机"],
          ["computer", "电脑"],
        ] as const
      ).map(([equipment, label]) => (
        <fieldset className="bot-fields" key={equipment}>
          <legend>{label}位置</legend>
          {(
            [
              ["x", "水平"],
              ["y", "垂直"],
              ["scale", "缩放"],
            ] as const
          ).map(([field, title]) => (
            <SettingRow key={field} title={title}>
              <TextField
                label={`${label}${title}`}
                labelClassName="sr-only"
                type="number"
                min={field === "scale" ? 0.1 : 0}
                max={field === "scale" ? 2 : 100}
                step={field === "scale" ? 0.01 : 1}
                value={String(media[equipment][field])}
                onValueChange={(value) => {
                  const number = Number(value);
                  if (Number.isFinite(number))
                    draft.change(equipment, {
                      ...media[equipment],
                      [field]: Math.max(
                        field === "scale" ? 0.1 : 0,
                        Math.min(field === "scale" ? 2 : 100, number),
                      ),
                    });
                }}
              />
            </SettingRow>
          ))}
        </fieldset>
      ))}
      <SettingRow title="角色形象">
        <Button
          type="button"
          size="small"
          variant="secondary"
          disabled={!dirty || action.busy || conflicted}
          onClick={() => {
            const input = {
              botId: profile.id,
              revision: profile.revision,
              headset: media.headset,
              computer: media.computer,
            };
            void action.run(["equipment", input], (requestId) =>
              saveBotIdentity(profile.id, equipmentFields, () =>
                client.work.identity({ ...input, requestId }),
              ),
            );
          }}
        >
          保存装备位置
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
      </SettingRow>
    </>
  );
}
