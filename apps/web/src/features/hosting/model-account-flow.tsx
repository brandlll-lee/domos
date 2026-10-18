import { Button } from "@domos/ui/controls";
import { ConfirmDialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { ChoicePicker, SearchPicker } from "@domos/ui/picker";
import { ArrowLeftIcon as ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { GearIcon as Settings2 } from "@phosphor-icons/react/dist/csr/Gear";
import { PlugIcon as Unplug } from "@phosphor-icons/react/dist/csr/Plug";
import { useEffect, useState } from "react";
import type { useModelAccount } from "./use-model-account.ts";

type ModelAccount = ReturnType<typeof useModelAccount>;

export function PiAccountFlow({
  account,
  adding,
  onAddingChange,
}: {
  account: ModelAccount;
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [method, setMethod] = useState("");
  const [value, setValue] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);
  const selected = account.selected;
  const login = account.login;
  const prompt = login?.prompt;

  useEffect(() => {
    if (login?.done && !login.error) {
      setEditing(false);
      onAddingChange(false);
    }
  }, [login, onAddingChange]);

  function chooseProvider(provider: string) {
    account.setProvider(provider);
    setMethod("");
    setValue("");
  }

  const methods = selected?.methods ?? [];
  const selectedMethod = method || methods[0]?.type || "";

  return (
    <div className="hosting-account-flow">
      {adding && (
        <div className="hosting-account-provider-search">
          <SearchPicker
            label="模型提供方"
            placeholder="选择提供方"
            searchLabel="搜索提供方…"
            emptyLabel="没有找到提供方"
            value={account.provider}
            disabled={account.busy || account.waiting}
            onValueChange={chooseProvider}
            items={
              account.catalog?.providers
                .filter((item) => !item.configured)
                .map((item) => ({ value: item.id, label: item.name })) ?? []
            }
          />
        </div>
      )}

      {selected?.configured && !editing && !account.waiting && (
        <div className="hosting-account-summary">
          <span>已连接账号</span>
          <Button
            variant="ghost"
            size="small"
            disabled={account.busy}
            onClick={() => setEditing(true)}
          >
            <Settings2 size={14} aria-hidden="true" />
            管理账号
          </Button>
        </div>
      )}

      {selected && (!selected.configured || editing) && !account.waiting && (
        <div className="hosting-account-setup">
          {methods.length > 1 && (
            <ChoicePicker
              label="连接方式"
              value={selectedMethod}
              onValueChange={setMethod}
              disabled={account.busy}
              items={methods.map((item) => ({
                value: item.type,
                label: item.name,
              }))}
            />
          )}
          {methods.length ? (
            <Button
              pending={account.busy}
              onClick={() => void account.connect(selectedMethod)}
            >
              {selected.configured ? "重新登录" : `连接 ${selected.name}`}
            </Button>
          ) : (
            <p className="detail-note">此提供方没有可用的连接方式。</p>
          )}
          {editing && (
            <div className="hosting-account-actions">
              <Button
                variant="ghost"
                size="icon-small"
                disabled={account.busy}
                aria-label="返回模型选择"
                title="返回模型选择"
                onClick={() => setEditing(false)}
              >
                <ArrowLeft size={15} aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="small"
                disabled={account.busy}
                onClick={() => setDisconnecting(true)}
              >
                <Unplug size={14} aria-hidden="true" />
                断开账号
              </Button>
            </div>
          )}
        </div>
      )}

      {account.waiting && (
        <div className="hosting-account-login">
          {login?.events.map((event) => (
            <div key={event.id} className="detail-note">
              {event.message} {event.userCode && <code>{event.userCode}</code>}
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
              className="hosting-account-prompt"
              onSubmit={(event) => {
                event.preventDefault();
                const submitted = value;
                setValue("");
                void account.answer(submitted);
              }}
            >
              {prompt.options ? (
                <ChoicePicker
                  label={prompt.message}
                  value={value}
                  onValueChange={setValue}
                  disabled={account.busy}
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
                  disabled={account.busy}
                />
              )}
              <Button pending={account.busy} disabled={!value}>
                继续
              </Button>
            </form>
          )}
          <Button
            variant="secondary"
            size="small"
            disabled={account.busy}
            onClick={() => {
              setValue("");
              void account.cancel();
            }}
          >
            取消登录
          </Button>
        </div>
      )}

      {account.error || login?.error ? (
        <p className="alert" role="alert">
          {account.error || login?.error}
        </p>
      ) : null}

      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="断开这个账号？"
        description="使用此账号的 Bot 需要重新连接模型。"
        confirmLabel="断开账号"
        onConfirm={() => void account.disconnect()}
      />
    </div>
  );
}
