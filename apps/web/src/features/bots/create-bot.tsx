import type { Bot } from "@domos/agent/bots";
import type { EngineId } from "@domos/agent/harness/types";
import type { ChatView } from "@domos/agent/view";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { SearchPicker } from "@domos/ui/picker";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useRef, useState } from "react";
import { client } from "../../client.ts";
import { rejectionMessage } from "../chat/request-error.ts";
import { ComputerLocation } from "../computer/location.tsx";
import { modelItems, modelKey, useModels } from "../models/use-models.ts";
import { useSettings } from "../settings/context.ts";
import { AvatarEditor } from "./avatar-editor.tsx";
import { EnginePanel } from "./details/engine.tsx";
import { EngineSelect } from "./engine-select.tsx";

export function CreateBot({
  model,
  onCreated,
}: {
  model: ChatView["model"];
  onCreated: (bot: Bot) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving) setOpen(value);
      }}
      title="新建 Bot"
      description="设置名字和职责，开始长期对话。"
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
          model={model}
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
  model,
  saving,
  onSavingChange,
  onCancel,
  onCreated,
}: {
  model: ChatView["model"];
  saving: boolean;
  onSavingChange: (saving: boolean) => void;
  onCancel: () => void;
  onCreated: (bot: Bot) => void;
}) {
  const { choices, error: catalogError } = useModels(true);
  const settings = useSettings();
  const [engine, setEngine] = useState<EngineId>("pi");
  const [computerReady, setComputerReady] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [avatar, setAvatar] = useState<string>(() => crypto.randomUUID());
  const [selection, setSelection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    bot: Bot;
    setup: Awaited<ReturnType<typeof client.computer.setup>>;
  }>();
  const request = useRef<{ id: string; payload: string } | null>(null);
  const preferred = choices?.find(
    (choice) => model && modelKey(choice) === modelKey(model),
  );
  const selected = selection ?? (preferred ? modelKey(preferred) : "");
  const choice = choices?.find((item) => modelKey(item) === selected);
  if (created)
    if (computerReady)
      return (
        <EnginePanel
          botId={created.bot.id}
          canManage={settings.admin}
          onReady={() => onCreated(created.bot)}
        />
      );
    else
      return (
        <div className="detail-stack">
          <h2>Bot 在哪里工作？</h2>
          <ComputerLocation
            botId={created.bot.id}
            {...created.setup}
            onBusyChange={onSavingChange}
            onReady={() => setComputerReady(true)}
          />
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
          instructions: instructions.trim(),
          avatar,
          engine: {
            provider: engine,
            model:
              engine === "pi" && choice
                ? `${choice.provider}/${choice.modelId}`
                : null,
          },
          model:
            engine === "pi" && choice
              ? { provider: choice.provider, modelId: choice.modelId }
              : undefined,
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
            maxLength={80}
          />
        </div>
        <TextField
          label="职责与指令"
          value={instructions}
          onValueChange={setInstructions}
          multiline
        />
        <EngineSelect value={engine} onChange={setEngine} disabled={saving} />
        {engine === "pi" && (
          <div className="field">
            <span className="field-label">默认模型</span>
            <SearchPicker
              label="默认模型"
              searchLabel="搜索模型…"
              emptyLabel="没有找到模型"
              placeholder="稍后连接"
              items={[{ value: "", label: "稍后连接" }, ...modelItems(choices)]}
              value={selected}
              disabled={saving}
              onValueChange={setSelection}
            />
          </div>
        )}
      </fieldset>
      {(error ?? (engine === "pi" && catalogError)) && (
        <p className="alert" role="alert">
          {error ?? catalogError}
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
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving ? "正在创建…" : "创建"}
        </Button>
      </div>
    </form>
  );
}
