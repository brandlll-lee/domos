import type { Bot } from "@domos/agent/bots";
import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { useState } from "react";
import { client } from "../../../client.ts";
import { AvatarEditor } from "../avatar-editor.tsx";
import type { Profile, WorkAction } from "./use-bot-work.ts";

export function IdentityEditor({
  profile,
  action,
  onSaved,
}: {
  profile: Profile;
  action: WorkAction;
  onSaved: (profile: Profile) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [instructions, setInstructions] = useState(profile.instructions);
  const [avatar, setAvatar] = useState(profile.avatar);
  const dirty =
    name !== profile.name ||
    instructions !== profile.instructions ||
    avatar !== profile.avatar;
  const input = {
    botId: profile.id,
    name,
    instructions,
    avatar,
    revision: profile.revision,
  };
  return (
    <form
      className="bot-form detail-card"
      aria-busy={action.busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty) return;
        void action.run(
          ["profile", input],
          (requestId) => client.work.update({ ...input, requestId }),
          onSaved,
        );
      }}
    >
      <fieldset className="bot-fields" disabled={action.busy}>
        <div className="profile-identity">
          <AvatarEditor value={avatar} onChange={setAvatar} />
          <TextField
            label="名字"
            value={name}
            onValueChange={setName}
            required
            maxLength={BOT_NAME_LENGTH}
          />
        </div>
        <TextField
          label="职责与长期指令"
          value={instructions}
          onValueChange={setInstructions}
          multiline
          maxLength={WORK_TEXT_LENGTH}
          placeholder="例如：帮我整理资料、准备每周工作计划。"
        />
        {dirty && (
          <div className="form-actions">
            <Button
              type="button"
              variant="ghost"
              size="small"
              onClick={() => {
                setName(profile.name);
                setInstructions(profile.instructions);
                setAvatar(profile.avatar);
              }}
            >
              还原
            </Button>
            <Button
              type="submit"
              size="small"
              aria-label="保存身份"
              pending={action.busy}
              disabled={!name.trim()}
            >
              保存
            </Button>
          </div>
        )}
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
          seed={profile?.avatar ?? bot.avatar}
          size="panel"
          statusLabel="正在工作"
        />
        <span className="bot-hero-pencil" aria-hidden="true">
          <PencilSimpleIcon size={12} />
        </span>
      </Button>
      <div className="bot-hero-copy">
        <h2>{profile?.name ?? bot.name}</h2>
        {profile?.instructions.trim() && <p>{profile.instructions}</p>}
      </div>
    </section>
  );
}
