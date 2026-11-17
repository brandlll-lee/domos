import type { Bot } from "@domos/agent/bots";
import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { InlineNotice } from "@domos/ui/message";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { client } from "../../../client.ts";
import { AvatarEditor } from "../avatar-editor.tsx";
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

const fieldLabels: Record<IdentityField, string> = {
  name: "名字",
  instructions: "职责与长期指令",
  appearance: "头像",
  headset: "耳机位置",
  computer: "电脑位置",
};

export function IdentityEditor({
  profile,
  action,
}: {
  profile: Profile;
  action: WorkAction;
}) {
  const draft = useIdentityDraft(profile);
  const { values, change, conflicts } = draft;
  const {
    name,
    instructions,
    appearance: { avatar, avatarAssetId },
  } = values;
  const setName = (name: string) => change("name", name);
  const setInstructions = (instructions: string) =>
    change("instructions", instructions);
  const setAvatar = (avatar: string) => draft.changeAppearance({ avatar });
  const dirty = draft.dirty.some((field) => identityFields.includes(field));
  const conflicted = conflicts.some((field) => identityFields.includes(field));
  const input = {
    botId: profile.id,
    name,
    instructions,
    avatar,
    avatarAssetId,
    revision: profile.revision,
  };
  return (
    <form
      className="bot-form"
      aria-busy={action.busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty || conflicted) return;
        void action.run(["profile", input], (requestId) =>
          saveBotIdentity(profile.id, identityFields, () =>
            client.work.update({ ...input, requestId }),
          ),
        );
      }}
    >
      <fieldset className="bot-fields" disabled={action.busy}>
        <fieldset className="bot-fields">
          <legend>基本资料</legend>
          <TextField
            label="名字"
            value={name}
            onValueChange={setName}
            required
            maxLength={BOT_NAME_LENGTH}
          />
          <TextField
            label="职责与长期指令"
            value={instructions}
            onValueChange={setInstructions}
            multiline
            maxLength={WORK_TEXT_LENGTH}
            placeholder="例如：帮我整理资料、准备每周工作计划。"
          />
        </fieldset>
        <AvatarEditor
          botId={profile.id}
          value={avatar}
          assetId={avatarAssetId}
          media={
            avatarAssetId === profile.avatarAssetId
              ? profile.avatarMedia
              : undefined
          }
          onAssetChange={(avatarAssetId) =>
            draft.changeAppearance({ avatarAssetId })
          }
          onChange={setAvatar}
        />
        {conflicts.map((field) => (
          <InlineNotice key={field}>
            <span>{fieldLabels[field]}已在别处更新。请选择要保留的内容。</span>
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
                    client.bots.retryCharacterMigration({ botId: profile.id }),
                  ),
                )
              }
            >
              重试收录角色
            </Button>
          </InlineNotice>
        )}
        {dirty && (
          <div className="form-actions">
            <Button
              type="button"
              variant="ghost"
              size="small"
              onClick={() => {
                draft.reset(identityFields);
                action.clear();
              }}
            >
              还原
            </Button>
            <Button
              type="submit"
              size="small"
              aria-label="保存身份"
              pending={action.busy}
              disabled={!name.trim() || conflicted}
            >
              保存
            </Button>
          </div>
        )}
        <AvatarEquipment profile={profile} action={action} />
      </fieldset>
    </form>
  );
}

export function BotIdentity({
  bot,
  profile,
  onEdit,
}: {
  bot: Bot;
  profile: Profile | null;
  onEdit: () => void;
}) {
  return (
    <section className="bot-hero" aria-label="Bot资料">
      <Button
        variant="ghost"
        size="icon"
        className="bot-hero-avatar"
        aria-label="编辑"
        onClick={onEdit}
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
