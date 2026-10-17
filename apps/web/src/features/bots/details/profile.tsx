import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { useState } from "react";
import { client } from "../../../client.ts";
import type { Profile, WorkAction } from "./use-bot-work.ts";

export function ProfileEditor({
  profile,
  action,
  onSaved,
  submitLabel,
}: {
  profile: Profile;
  action: WorkAction;
  onSaved: (profile: Profile) => void;
  submitLabel?: string;
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
      className="bot-form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(
          ["profile", input],
          (requestId) => client.work.update({ ...input, requestId }),
          onSaved,
        );
      }}
    >
      <fieldset className="bot-fields" disabled={action.busy}>
        <div className="avatar-customize">
          <BotAvatar seed={avatar} size="large" />
          <Button
            type="button"
            variant="secondary"
            size="icon-small"
            aria-label="换个形象"
            onClick={() => setAvatar(crypto.randomUUID())}
          >
            <PencilSimpleIcon size={14} />
          </Button>
        </div>
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
        />
        {(dirty || submitLabel) && (
          <div className="form-actions">
            {!submitLabel && (
              <Button
                type="button"
                variant="secondary"
                size="small"
                onClick={() => {
                  setName(profile.name);
                  setInstructions(profile.instructions);
                  setAvatar(profile.avatar);
                }}
              >
                还原
              </Button>
            )}
            <Button type="submit" size="small" disabled={!name.trim()}>
              {submitLabel ?? "保存身份"}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
