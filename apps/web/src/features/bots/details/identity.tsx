import type { Bot } from "@domos/agent/bots";
import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { InlineNotice } from "@domos/ui/message";
import { PanelHeader } from "@domos/ui/panel";
import { ScrollArea } from "@domos/ui/scroll-area";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { useState } from "react";
import { client } from "../../../client.ts";
import {
  AvatarEditor,
  IdentityPreview,
  useCharacterMedia,
} from "../avatar-editor.tsx";
import { useCustomColors } from "../color-preferences.ts";
import { AvatarEquipment } from "./avatar-equipment.tsx";
import {
  equipmentFields,
  type IdentityField,
  identityFields,
} from "./identity-state.ts";
import {
  type Profile,
  saveBotIdentity,
  useIdentityDraft,
  type WorkAction,
} from "./use-bot-work.ts";

const fields = [...identityFields, ...equipmentFields];
const fieldLabels: Record<IdentityField, string> = {
  name: "名字",
  instructions: "长期指令",
  appearance: "头像",
  headset: "耳机位置",
  computer: "电脑位置",
};

export function IdentityEditor({
  profile,
  action,
  onClose,
  onBack,
}: {
  profile: Profile;
  action: WorkAction;
  onClose: () => void;
  onBack: () => void;
}) {
  const draft = useIdentityDraft(profile);
  const { values, conflicts } = draft;
  const {
    name,
    instructions,
    appearance: { avatar, avatarAssetId },
  } = values;
  const { source, data } = useCharacterMedia(
    profile.id,
    avatarAssetId,
    avatarAssetId === profile.avatarAssetId ? profile.avatarMedia : undefined,
  );
  const [page, setPage] = useState<"profile" | "appearance" | "equipment">(
    "profile",
  );
  const [colors, setColors] = useCustomColors();
  const dirty = draft.dirty.length > 0;
  const input = {
    botId: profile.id,
    name,
    instructions,
    avatar,
    avatarAssetId,
    revision: profile.revision,
    headset: source ? values.headset : undefined,
    computer: source ? values.computer : undefined,
  };
  return (
    <section className="profile-editor" aria-label="编辑资料">
      <PanelHeader
        title={
          page === "profile"
            ? "编辑资料"
            : page === "appearance"
              ? "外观"
              : "装备位置"
        }
        onClose={onClose}
        onBack={() =>
          page === "profile"
            ? onBack()
            : setPage(page === "equipment" ? "appearance" : "profile")
        }
      />
      <ScrollArea
        className="profile-scroll"
        viewportClassName="profile-viewport"
      >
        <form
          id={`profile-${profile.id}`}
          className="profile-body"
          aria-busy={action.busy}
          onSubmit={(event) => {
            event.preventDefault();
            if (!dirty || conflicts.length || !name.trim() || action.busy)
              return;
            void action.run(["profile", input], (requestId) =>
              saveBotIdentity(profile.id, fields, () =>
                client.work.update({ ...input, requestId }),
              ),
            );
          }}
        >
          <fieldset className="bot-fields" disabled={action.busy}>
            {page === "profile" ? (
              <>
                <IdentityPreview
                  name={name}
                  avatar={avatar}
                  media={source}
                  onEdit={() => setPage("appearance")}
                />
                <div className="profile-info-fields">
                  <TextField
                    label="名字"
                    value={name}
                    onValueChange={(value) => draft.change("name", value)}
                    required
                    maxLength={BOT_NAME_LENGTH}
                  />
                  <TextField
                    label="长期指令"
                    description="告诉伙伴，你希望它怎样帮助你。"
                    value={instructions}
                    onValueChange={(value) =>
                      draft.change("instructions", value)
                    }
                    multiline
                    maxLength={WORK_TEXT_LENGTH}
                  />
                </div>
              </>
            ) : page === "appearance" ? (
              <AvatarEditor
                value={avatar}
                assetId={avatarAssetId}
                source={source}
                characters={data}
                onAssetChange={(id) =>
                  draft.changeAppearance({ avatarAssetId: id })
                }
                onChange={(avatar) => draft.changeAppearance({ avatar })}
                onEquipment={() => setPage("equipment")}
                colors={colors}
                onColorsChange={setColors}
              />
            ) : (
              source && (
                <AvatarEquipment
                  avatar={avatar}
                  source={source}
                  headset={values.headset ?? source.headset}
                  computer={values.computer ?? source.computer}
                  onChange={(field, value) =>
                    draft.change(field, value, source[field])
                  }
                />
              )
            )}
            {conflicts.map((field) => (
              <InlineNotice key={field}>
                <span>
                  {fieldLabels[field]}已在别处更新。请选择要保留的内容。
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    draft.resolve(field, "current");
                    action.clear();
                  }}
                >
                  使用最新值
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={
                    equipmentFields.includes(field) && avatarAssetId === null
                  }
                  onClick={() => {
                    draft.resolve(field, "draft");
                    action.clear();
                  }}
                >
                  保留我的修改
                </Button>
              </InlineNotice>
            ))}
            {profile.avatarMigrationError && (
              <InlineNotice>
                <span>{profile.avatarMigrationError}</span>
                <Button
                  type="button"
                  variant="ghost"
                  pending={action.busy}
                  onClick={() =>
                    void action.run({ migration: profile.id }, () =>
                      saveBotIdentity(profile.id, [], () =>
                        client.bots.retryCharacterMigration({
                          botId: profile.id,
                        }),
                      ),
                    )
                  }
                >
                  重试收录角色
                </Button>
              </InlineNotice>
            )}
          </fieldset>
        </form>
      </ScrollArea>
      <footer className="profile-footer">
        <span
          className="profile-save-state"
          role={action.busy ? "status" : undefined}
        >
          {action.busy ? "正在保存…" : dirty ? "有未保存的修改" : ""}
        </span>
        <Button
          type="button"
          variant="ghost"
          disabled={!dirty || action.busy}
          onClick={() => {
            draft.reset(fields);
            action.clear();
          }}
        >
          还原
        </Button>
        <Button
          type="submit"
          form={`profile-${profile.id}`}
          aria-label="保存身份"
          pending={action.busy}
          disabled={!dirty || !name.trim() || conflicts.length > 0}
        >
          保存
        </Button>
      </footer>
    </section>
  );
}
export function BotIdentity({
  bot,
  profile,
  onEdit,
  pending,
}: {
  bot: Bot;
  profile: Profile | null;
  onEdit: () => void;
  pending: boolean;
}) {
  return (
    <section className="bot-hero" aria-label="Bot资料">
      <Button
        variant="ghost"
        size="icon"
        className="bot-hero-avatar"
        aria-label="编辑"
        onClick={onEdit}
        pending={pending}
      >
        <BotAvatar
          botId={bot.id}
          interactive
          seed={bot.avatar}
          size="panel"
          statusLabel="正在工作"
        />
        <span className="bot-hero-pencil" aria-hidden="true">
          <PencilSimpleIcon size={12} />
        </span>
      </Button>
      <div className="bot-hero-copy">
        <h2>{bot.name}</h2>
        {profile?.instructions.trim() && <p>{profile.instructions}</p>}
      </div>
    </section>
  );
}
