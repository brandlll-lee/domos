import type { Bot } from "@domos/agent/bots";
import { BOT_NAME_LENGTH } from "@domos/agent/work/limits";
import { BotAvatar } from "@domos/ui/avatar";
import { characterSeed } from "@domos/ui/characters";
import { Button } from "@domos/ui/controls";
import { Dialog, DialogFooter } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { useEffect, useRef, useState } from "react";
import { client } from "../../client.ts";
import { rejectionMessage } from "../chat/request-error.ts";
import { AvatarEditor } from "./avatar-editor.tsx";
import { ModelSetup } from "./details/model.tsx";

export function CreateBot({
  finalFocus,
  onCreated,
  open,
  onOpenChange,
}: {
  finalFocus: () => HTMLElement | null;
  onCreated: (bot: Bot) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      finalFocus={finalFocus}
      open={open}
      onOpenChange={(value) => {
        if (!saving) setOpen(value);
      }}
      title="新建 Bot"
      description="取个名字，再选择模型。"
    >
      {open && (
        <BotForm
          saving={saving}
          onSavingChange={setSaving}
          onCancel={() => setOpen(false)}
          onCreated={(bot) => {
            setOpen(false);
            onCreated(bot);
          }}
        />
      )}
    </Dialog>
  );
}

function BotForm({
  saving,
  onSavingChange,
  onCancel,
  onCreated,
}: {
  saving: boolean;
  onSavingChange: (saving: boolean) => void;
  onCancel: () => void;
  onCreated: (bot: Bot) => void;
}) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(characterSeed);
  const [avatarAssetId, setAvatarAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Bot>();
  const [second, setSecond] = useState(false);
  useEffect(() => {
    void client.bots.list().then(
      (bots) => setSecond(bots.length === 1),
      () => {},
    );
  }, []);
  const request = useRef<{ id: string; payload: string } | null>(null);
  if (created)
    return (
      <ModelSetup
        botId={created.id}
        onBusyChange={onSavingChange}
        onReady={() => onCreated(created)}
      />
    );
  return (
    <form
      id="create-bot"
      className="bot-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!name.trim() || saving) return;
        const input = {
          name: name.trim(),
          avatar,
          avatarAssetId: avatarAssetId ?? undefined,
        };
        const payload = JSON.stringify(input);
        if (request.current?.payload !== payload)
          request.current = { id: crypto.randomUUID(), payload };
        onSavingChange(true);
        setError(null);
        try {
          const bot = await client.bots.create({
            ...input,
            requestId: request.current.id,
          });
          setCreated(bot);
        } catch (cause) {
          setError(
            rejectionMessage(cause) ?? "创建未确认。请重试，系统会核对原请求。",
          );
        } finally {
          onSavingChange(false);
        }
      }}
    >
      {second && (
        <>
          <p className="setup-team-heading">不同的事，交给不同的 Bot</p>
          <section className="setup-team" aria-label="Bot 用途示例">
            {(
              [
                ["项目开发", "triangle", "#659fff"],
                ["资料研究", "cloud", "#46d99e"],
                ["日常事务", "round", "#f8bd3e"],
              ] as const
            ).map(([label, shape, color]) => (
              <div key={label}>
                <BotAvatar seed={characterSeed(shape, color)} size="panel" />
                <span>{label}</span>
              </div>
            ))}
          </section>
        </>
      )}
      <fieldset disabled={saving} className="bot-fields">
        <TextField
          label="名字"
          value={name}
          onValueChange={setName}
          required
          maxLength={BOT_NAME_LENGTH}
        />
        <AvatarEditor
          value={avatar}
          onChange={setAvatar}
          assetId={avatarAssetId}
          onAssetChange={setAvatarAssetId}
        />
      </fieldset>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <DialogFooter>
        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={saving}
          >
            取消
          </Button>
          <Button
            type="submit"
            form="create-bot"
            pending={saving}
            disabled={!name.trim()}
          >
            {saving ? "正在创建…" : "创建"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
