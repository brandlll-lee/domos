import type { Bot } from "@domos/agent/bots";
import { BOT_NAME_LENGTH } from "@domos/agent/work/limits";
import { characterSeed } from "@domos/ui/characters";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useRef, useState } from "react";
import { client } from "../../client.ts";
import { rejectionMessage } from "../chat/request-error.ts";
import { ComputerLocation } from "../computer/location.tsx";
import { useSettings } from "../settings/context.ts";
import { AvatarEditor } from "./avatar-editor.tsx";
import { EnginePanel } from "./details/engine.tsx";

export function CreateBot({ onCreated }: { onCreated: (bot: Bot) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving) setOpen(value);
      }}
      title="新建 Bot"
      description="取个名字，再选择工作电脑和引擎。"
      trigger={
        <Button
          variant="ghost"
          size="icon-small"
          aria-label="新建 Bot"
          title="新建 Bot"
        >
          <PlusIcon />
        </Button>
      }
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
  const settings = useSettings();
  const [computerReady, setComputerReady] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(characterSeed);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    bot: Bot;
    setup: Awaited<ReturnType<typeof client.computer.setup>>;
  }>();
  const request = useRef<{ id: string; payload: string } | null>(null);
  if (created)
    return (
      <div className="detail-stack">
        <h2>{computerReady ? "由谁处理任务？" : "Bot 在哪里工作？"}</h2>
        <div hidden={computerReady}>
          <ComputerLocation
            botId={created.bot.id}
            {...created.setup}
            onBusyChange={onSavingChange}
            onReady={() => setComputerReady(true)}
          />
        </div>
        {computerReady && (
          <EnginePanel
            botId={created.bot.id}
            canManage={settings.admin}
            onBusyChange={onSavingChange}
            onBack={() => setComputerReady(false)}
            onReady={() => onCreated(created.bot)}
          />
        )}
      </div>
    );
  return (
    <form
      className="bot-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!name.trim() || saving) return;
        const input = {
          name: name.trim(),
          avatar,
        };
        const payload = JSON.stringify(input);
        if (request.current?.payload !== payload)
          request.current = { id: crypto.randomUUID(), payload };
        onSavingChange(true);
        setError(null);
        try {
          const setup = await client.computer.setup();
          const bot = await client.bots.create({
            ...input,
            engine: { provider: "pi", model: null },
            computerId: null,
            requestId: request.current.id,
          });
          setCreated({ bot, setup });
        } catch (cause) {
          setError(
            rejectionMessage(cause) ?? "创建未确认。请重试，系统会核对原请求。",
          );
        } finally {
          onSavingChange(false);
        }
      }}
    >
      <fieldset disabled={saving} className="bot-fields">
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
      </fieldset>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
        >
          取消
        </Button>
        <Button type="submit" pending={saving} disabled={!name.trim()}>
          {saving ? "正在创建…" : "创建"}
        </Button>
      </div>
    </form>
  );
}
