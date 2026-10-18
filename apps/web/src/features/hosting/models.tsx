import { Button } from "@domos/ui/controls";
import { ConfirmDialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { ChoicePicker, SearchPicker } from "@domos/ui/picker";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { useModelAccount } from "./use-model-account.ts";

export function HostingModels({
  onConfigured,
  botId,
  model,
  onBusyChange,
  formId,
}: {
  onConfigured: () => void;
  botId?: number;
  model?: string | null;
  onBusyChange?: (busy: boolean) => void;
  formId?: string;
}) {
  const separator = model?.indexOf("/") ?? -1;
  const initial =
    model && separator > 0
      ? {
          provider: model.slice(0, separator),
          modelId: model.slice(separator + 1),
        }
      : null;
  const account = useModelAccount(onBusyChange, initial?.provider);
  const { catalog, selected, provider, login, busy, waiting } = account;
  const [editing, setEditing] = useState(false);
  const [method, setMethod] = useState("");
  const [value, setValue] = useState("");
  const [selection, setSelection] = useState(
    initial ? JSON.stringify(initial) : "",
  );
  const [disconnecting, setDisconnecting] = useState(false);
  const prompt = login?.prompt;
  const models =
    catalog?.models.filter((item) => item.provider === provider) ?? [];
  const selectedModel = models.find(
    (item) =>
      JSON.stringify({ provider: item.provider, modelId: item.modelId }) ===
      selection,
  );
  const changed =
    selectedModel &&
    `${selectedModel.provider}/${selectedModel.modelId}` !== model;
  const chooseProvider = (provider: string) => {
    account.setProvider(provider);
    setEditing(false);
    setMethod("");
    setValue("");
    setSelection("");
  };
  useEffect(() => {
    if (login?.done && !login.error) setEditing(false);
  }, [login]);
  return (
    <section
      className="model-connection detail-stack"
      aria-label="模型配置"
      aria-busy={busy}
      data-dirty={Boolean(value || changed || waiting)}
    >
      {!catalog && (
        <p className="detail-note" role="status">
          正在读取账号…
        </p>
      )}
      {(!selected?.configured || editing) && (
        <div className="field">
          <span className="field-label">模型提供方</span>
          <SearchPicker
            label="模型提供方"
            placeholder="选择提供方"
            searchLabel="搜索提供方…"
            emptyLabel="没有找到提供方"
            value={provider}
            disabled={busy || waiting}
            onValueChange={chooseProvider}
            items={
              catalog?.providers
                .toSorted((a, b) => Number(b.configured) - Number(a.configured))
                .map((item) => ({
                  value: item.id,
                  label: `${item.name}${item.configured ? " · 已连接" : ""}`,
                })) ?? []
            }
          />
        </div>
      )}
      {selected?.configured && !editing && (
        <div className="account-summary">
          <div>
            <strong>{selected.name}</strong>
            <span className="detail-note">已连接</span>
          </div>
          <Button variant="ghost" size="small" onClick={() => setEditing(true)}>
            更换账号
          </Button>
        </div>
      )}
      {selected && (!selected.configured || editing) && !waiting && (
        <div className="detail-stack">
          {selected.methods.length > 1 && (
            <ChoicePicker
              label="连接方式"
              value={method || selected.methods[0]?.type || ""}
              onValueChange={setMethod}
              disabled={busy}
              items={selected.methods.map((item) => ({
                value: item.type,
                label: item.name,
              }))}
            />
          )}
          {!!selected.methods.length && (
            <Button
              pending={busy}
              onClick={() =>
                void account.connect(method || selected.methods[0]?.type || "")
              }
            >
              {selected.configured ? "重新登录" : `连接 ${selected.name}`}
            </Button>
          )}
          {editing && (
            <div className="detail-actions">
              <Button
                variant="ghost"
                size="small"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                返回模型选择
              </Button>
              <Button
                variant="ghost"
                size="small"
                disabled={busy}
                onClick={() => setDisconnecting(true)}
              >
                断开账号
              </Button>
            </div>
          )}
        </div>
      )}
      {waiting && (
        <div className="detail-stack">
          {login?.events.map((event) => (
            <div key={event.id} className="detail-note">
              {event.message}{" "}
              {event.userCode && (
                <code className="pairing-code">{event.userCode}</code>
              )}
              {(event.url ?? event.verificationUri)?.startsWith("https://") && (
                <a
                  href={event.url ?? event.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开登录页面
                </a>
              )}
            </div>
          ))}
          {prompt && (
            <form
              className="detail-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void account.answer(value).then(() => setValue(""));
              }}
            >
              {prompt.options ? (
                <ChoicePicker
                  label={prompt.message}
                  value={value}
                  onValueChange={setValue}
                  disabled={busy}
                  items={[
                    { value: "", label: "请选择" },
                    ...prompt.options.map((item) => ({
                      value: item.id,
                      label: item.label,
                    })),
                  ]}
                />
              ) : (
                <TextField
                  label={prompt.message}
                  type={prompt.type === "secret" ? "password" : "text"}
                  value={value}
                  onValueChange={setValue}
                  autoComplete="off"
                  disabled={busy}
                />
              )}
              <Button pending={busy} disabled={!value}>
                继续
              </Button>
            </form>
          )}
          <Button
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={() => void account.cancel()}
          >
            取消登录
          </Button>
        </div>
      )}
      {botId !== undefined && selected?.configured && !editing && !waiting && (
        <form
          className="detail-stack"
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            void account.action(async () => {
              if (!selection) throw new Error("请选择一个模型。");
              await client.models.select({ botId, ...JSON.parse(selection) });
              window.dispatchEvent(new Event("domos:models"));
              setSelection("");
              onConfigured();
            });
          }}
        >
          <div className="field">
            <span className="field-label">对话模型</span>
            <SearchPicker
              label="此 Bot 的模型"
              placeholder="选择已连接的模型"
              searchLabel="搜索模型…"
              emptyLabel="没有可用模型"
              value={selection}
              disabled={busy}
              onValueChange={setSelection}
              items={models.map((item) => ({
                value: JSON.stringify({
                  provider: item.provider,
                  modelId: item.modelId,
                }),
                label: item.name,
              }))}
            />
          </div>
          {!formId && (
            <Button type="submit" pending={busy} disabled={!selection}>
              保存模型
            </Button>
          )}
        </form>
      )}
      {(account.error || login?.error) && (
        <p className="alert" role="alert">
          {account.error || login?.error}
        </p>
      )}
      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="断开这个账号？"
        description="使用此账号的 Bot 需要重新连接模型。"
        confirmLabel="断开账号"
        onConfirm={() => void account.disconnect()}
      />
    </section>
  );
}
