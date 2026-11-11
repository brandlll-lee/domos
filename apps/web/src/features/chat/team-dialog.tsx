import type { BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { Checkbox, TextField } from "@domos/ui/field";
import { useRef, useState } from "react";
import { client } from "../../client.ts";

export function TeamDialog({
  finalFocus,
  bots,
  open,
  onOpenChange,
  onSaved,
  team,
}: {
  finalFocus?: () => HTMLElement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: BotPresence[];
  onSaved: (team: Team) => void;
  team?: Team;
}) {
  const setOpen = onOpenChange;
  const [name, setName] = useState(team?.name ?? "");
  const [purpose, setPurpose] = useState(team?.purpose ?? "");
  const [members, setMembers] = useState<number[]>(team?.members ?? []);
  const [owner, setOwner] = useState<number | undefined>(team?.owner);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const requestId = useRef(crypto.randomUUID());
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      finalFocus={finalFocus}
      title={team ? "编辑团队" : "新建 Bot 团队"}
      footer={
        <div className="dialog-actions">
          <Button
            variant="secondary"
            disabled={saving}
            onClick={() => setOpen(false)}
          >
            取消
          </Button>
          <Button
            pending={saving}
            disabled={!name.trim() || !members.length || owner === undefined}
            onClick={async () => {
              if (owner === undefined) return;
              setSaving(true);
              setError(undefined);
              try {
                const saved = await (team
                  ? client.teams.update
                  : client.teams.create)({
                  id: team?.id ?? requestId.current,
                  name,
                  purpose,
                  members,
                  owner,
                });
                onSaved(saved);
                requestId.current = crypto.randomUUID();
                setOpen(false);
                setName("");
                setPurpose("");
                setMembers([]);
                setOwner(undefined);
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "团队保存失败。",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {team ? "保存" : "创建"}
          </Button>
        </div>
      }
    >
      <div className="team-form">
        <TextField
          label="团队名称"
          value={name}
          onValueChange={setName}
          maxLength={BOT_NAME_LENGTH}
        />
        <TextField
          label="团队用途"
          value={purpose}
          onValueChange={setPurpose}
          multiline
          maxLength={WORK_TEXT_LENGTH}
        />
        <fieldset className="team-member-list">
          <legend>成员</legend>
          {bots.map((bot) => (
            <div className="team-member" key={bot.id}>
              <BotAvatar seed={bot.avatar} size="small" />
              <Checkbox
                label={bot.name}
                checked={members.includes(bot.id)}
                onCheckedChange={(checked) => {
                  setMembers((current) =>
                    checked
                      ? [...current, bot.id]
                      : current.filter((id) => id !== bot.id),
                  );
                  if (checked) setOwner((current) => current ?? bot.id);
                  else if (owner === bot.id)
                    setOwner(members.find((id) => id !== bot.id));
                }}
              />
              {members.includes(bot.id) && (
                <Button
                  variant="ghost"
                  size="small"
                  aria-pressed={owner === bot.id}
                  onClick={() => setOwner(bot.id)}
                >
                  {owner === bot.id ? "默认负责人" : "设为负责人"}
                </Button>
              )}
            </div>
          ))}
        </fieldset>
        {team?.members.some((id) => !members.includes(id)) && (
          <p className="detail-note">
            移除成员会停止该成员在此团队中的未完成任务。历史消息会保留。
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
