import type { EngineConfig } from "@domos/agent/harness/types";
import { EngineMark } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { DialogFooter } from "@domos/ui/dialog";
import { Loading } from "@domos/ui/loading";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../../client.ts";
import { ComputerPermission } from "../../computer/permission.tsx";
import { ModelSetting } from "../../models/model-setting.tsx";
import { useModelSettings } from "../../models/model-state.ts";
import { useSettings } from "../../settings/context.ts";

export function ModelSetup({
  botId,
  onBusyChange,
  onReady,
}: {
  botId: number;
  onBusyChange?: (busy: boolean) => void;
  onReady?: () => void;
}) {
  const settings = useSettings();
  const setup = Boolean(onReady);
  const { profile, store } = useModelSettings(botId);
  const [binding, setBinding] =
    useState<Awaited<ReturnType<typeof client.computer.get>>>();
  const [provider, setProvider] = useState<EngineConfig["provider"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reportBusy = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusyChange?.(value);
    },
    [onBusyChange],
  );
  const refresh = useCallback(
    async (reload = false) => {
      const [binding] = await Promise.all([
        client.computer.get({ botId }),
        store.load(reload),
      ]);
      setBinding(binding);
    },
    [botId, store],
  );
  useEffect(() => {
    void refresh().catch((cause) => setError(cause.message));
  }, [refresh]);
  useEffect(() => {
    if (!setup && profile) setProvider(profile.config.provider);
  }, [setup, profile]);
  if (!binding || !profile)
    return error ? (
      <p role="alert">{error}</p>
    ) : (
      <Loading label="正在读取连接" />
    );
  const providers = profile.providers.filter(
    (item) => settings.admin || item.id === profile.config.provider,
  );
  if (!provider) {
    return (
      <section className="setup-providers" aria-label="可用连接">
        {providers.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            className="setup-provider"
            aria-label={item.name}
            disabled={profile.busy}
            onClick={() => setProvider(item.id)}
          >
            <EngineMark provider={item.id} />
            <span>{item.name}</span>
            {profile.connection?.ready &&
              profile.config.provider === item.id && (
                <span className="setup-provider-status">
                  {profile.connection.authenticated ? "已连接" : "待登录"}
                </span>
              )}
            <CaretRightIcon aria-hidden="true" />
          </Button>
        ))}
      </section>
    );
  }
  const goBack = () => {
    if (!busy) setProvider(undefined);
  };
  const back = (
    <Button variant="secondary" disabled={busy} onClick={goBack}>
      返回
    </Button>
  );
  if (!binding.computer?.authorized)
    return (
      <ComputerPermission
        botId={botId}
        onReady={() => refresh(true)}
        onBusyChange={reportBusy}
        footer={back}
      />
    );
  const continueAction = onReady && (
    <Button
      disabled={
        busy ||
        profile.config.provider !== provider ||
        !(profile.revision || profile.prepared)
      }
      onClick={onReady}
    >
      开始聊天
    </Button>
  );
  const model = (
    <div className="model-setup">
      <ModelSetting
        key={provider}
        botId={botId}
        connected
        disabled={profile.busy}
        setupProvider={setup ? provider : undefined}
        onBusyChange={reportBusy}
      />
      <DialogFooter>
        <div className="setup-actions">
          {continueAction}
          {setup && back}
        </div>
      </DialogFooter>
    </div>
  );
  return model;
}
