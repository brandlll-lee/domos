import { Button } from "@domos/ui/controls";
import { useCallback, useState } from "react";
import { PiAccountFlow } from "../hosting/model-account-flow.tsx";
import { useModelAccount } from "../hosting/use-model-account.ts";

export function PiProviderSettings({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const account = useModelAccount(onBusyChange);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const close = useCallback(() => setManaging(false), []);
  const disabled = account.busy || account.waiting;
  return (
    <section className="settings-group" aria-label="Pi 连接">
      <div className="provider-row">
        <strong>提供方</strong>
        <span className="detail-note">服务账号</span>
        <Button
          variant="secondary"
          size="small"
          disabled={!account.catalog || disabled}
          onClick={() => {
            account.setProvider("");
            setAdding(!adding);
            setManaging(false);
          }}
        >
          {adding ? "返回列表" : "添加提供方"}
        </Button>
      </div>
      {!account.catalog && (
        <p className="detail-note" role="status">
          正在读取账号…
        </p>
      )}
      {!adding &&
        !managing &&
        account.catalog?.providers
          .filter((item) => item.configured)
          .map((item) => (
            <div className="provider-account-row" key={item.id}>
              <span>{item.name}</span>
              <span className="detail-note">已连接</span>
              <Button
                variant="ghost"
                size="small"
                disabled={disabled}
                onClick={() => {
                  account.setProvider(item.id);
                  setManaging(true);
                }}
              >
                管理
              </Button>
            </div>
          ))}
      {!adding &&
        !managing &&
        account.catalog &&
        !account.catalog.providers.some((item) => item.configured) && (
          <p className="detail-note">尚未连接提供方</p>
        )}
      {(adding || managing) && (
        <PiAccountFlow
          key={account.provider}
          account={account}
          adding={adding}
          onAddingChange={setAdding}
          manage={managing}
          onBack={close}
        />
      )}
      {account.error && !adding && !managing && (
        <p className="alert" role="alert">
          {account.error}
        </p>
      )}
    </section>
  );
}
