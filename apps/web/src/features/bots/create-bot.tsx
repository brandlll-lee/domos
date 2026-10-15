import type { Bot } from "@domos/agent/bots";
import type { ChatView } from "@domos/agent/view";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { SearchPicker } from "@domos/ui/picker";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useRef, useState } from "react";
import { client } from "../../client.ts";
import { rejectionMessage } from "../chat/request-error.ts";
import { modelItems, modelKey, useModels } from "../models/use-models.ts";

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
          size="icon"
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
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [avatar, setAvatar] = useState(() => crypto.randomUUID());
  const [selection, setSelection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ id: string; payload: string } | null>(null);
  const preferred = choices?.find(
    (choice) => model && modelKey(choice) === modelKey(model),
  );
  const selected =
    selection ??
    (preferred
      ? modelKey(preferred)
      : choices?.[0]
        ? modelKey(choices[0])
        : "");
  const choice = choices?.find((item) => modelKey(item) === selected);
  return (
    <form
      className="bot-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!choice || !name.trim() || saving) return;
        const input = {
          name: name.trim(),
          instructions: instructions.trim(),
          avatar,
          model: { provider: choice.provider, modelId: choice.modelId },
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
          onCreated(bot);
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
        <div className="avatar-customize">
          <BotAvatar seed={avatar} size="large" />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setAvatar(crypto.randomUUID())}
          >
            换个形象
          </Button>
        </div>
        <TextField
          label="名字"
          value={name}
          onValueChange={setName}
          required
          maxLength={80}
        />
        <TextField
          label="职责与指令"
          value={instructions}
          onValueChange={setInstructions}
          multiline
        />
        <div className="field">
          <span className="field-label">默认模型</span>
          <SearchPicker
            label="默认模型"
            searchLabel="搜索模型…"
            emptyLabel="没有找到模型"
            placeholder={choices === null ? "正在加载…" : "没有可用模型"}
            items={modelItems(choices)}
            value={selected}
            disabled={choices === null || choices.length === 0 || saving}
            onValueChange={setSelection}
          />
        </div>
      </fieldset>
      {(error ?? catalogError) && (
        <p className="alert" role="alert">
          {error ?? catalogError}
        </p>
      )}
      {choices?.length === 0 && (
        <p className="alert" role="status">
          请配置服务商凭据后重启服务。
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
        <Button type="submit" disabled={saving || !name.trim() || !choice}>
          {saving ? "正在创建…" : "创建"}
        </Button>
      </div>
    </form>
  );
}
