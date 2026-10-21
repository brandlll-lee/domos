import type { EngineId } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { Tabs } from "@domos/ui/tabs";
import { useEffect, useRef, useState } from "react";
import { client } from "../../client.ts";
import { EngineAccount } from "../bots/details/engine-account.tsx";
import { useEngine } from "../bots/details/use-engine.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import { userError } from "../user-error.ts";
import { PiProviderSettings } from "./pi-providers.tsx";
import { useConnectionContext } from "./use-connection-context.ts";
import "../bots/details/engine.css";

export function ProviderSettings({ botId }: { botId?: number }) {
  const { target, error: contextError } = useConnectionContext(botId);
  const [providers, setProviders] = useState<
    Awaited<ReturnType<typeof client.engines.catalog>>
  >([]);
  const [selected, setSelected] = useState<EngineId>("pi");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void client.engines
      .catalog()
      .then(setProviders, (cause) =>
        setError(userError(cause, "引擎目录读取失败。")),
      );
  }, []);
  return (
    <Tabs.Root
      className="settings-sections"
      value={selected}
      onValueChange={(id) => setSelected(id as EngineId)}
    >
      {target && (
        <p className="detail-note">
          {target.name} · {target.computer}
        </p>
      )}
      <Tabs.List className="provider-tabs" aria-label="连接引擎">
        {providers.map((item) => (
          <Tabs.Tab
            render={<Button variant="ghost" size="small" />}
            key={item.id}
            value={item.id}
            disabled={busy}
          >
            <EngineMark provider={item.id} />
            {item.name}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <Tabs.Panel value={selected}>
        {selected === "pi" ? (
          <PiProviderSettings onBusyChange={setBusy} />
        ) : (
          target && (
            <NativeProvider
              key={`${target.id}:${selected}`}
              botId={target.id}
              provider={selected}
              onBusyChange={setBusy}
            />
          )
        )}
      </Tabs.Panel>
      {(error || contextError) && (
        <p className="alert" role="alert">
          {error || contextError}
        </p>
      )}
    </Tabs.Root>
  );
}

function NativeProvider({
  botId,
  provider,
  onBusyChange,
}: {
  botId: number;
  provider: EngineId;
  onBusyChange: (busy: boolean) => void;
}) {
  const setup = useEngine(botId, true, undefined, provider);
  const checked = useRef(false);
  useEffect(() => {
    onBusyChange(Boolean(setup.pending) || setup.login?.state === "waiting");
  }, [setup.pending, setup.login?.state, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => {
    if (checked.current || !setup.profile) return;
    checked.current = true;
    void setup.inspect(false);
  }, [setup]);
  const name =
    setup.profile?.providers.find((item) => item.id === provider)?.name ??
    provider;
  return (
    <section
      className="settings-group"
      aria-label={`${name} 连接`}
      aria-busy={Boolean(setup.pending) || setup.login?.state === "waiting"}
    >
      <div className="provider-row">
        <strong>{name}</strong>
        <span className="detail-note">{setup.connection?.version}</span>
        <span className="detail-note">
          {setup.pending === "inspect"
            ? "正在检查…"
            : setup.connection?.authenticated
              ? "已连接"
              : setup.connection?.ready === false
                ? "未安装"
                : "待连接"}
        </span>
        <Button
          variant="secondary"
          size="small"
          disabled={setup.busy}
          onClick={() => void setup.inspect()}
        >
          检查连接
        </Button>
      </div>
      {setup.connection?.ready === false ? (
        <Button disabled={setup.busy} onClick={() => void setup.install()}>
          安装 {name}
        </Button>
      ) : (
        setup.connection && (
          <EngineAccount
            provider={provider}
            botId={botId}
            setup={setup}
            canManage
            onConnected={() => {}}
          />
        )
      )}
      {setup.login?.state === "waiting" && (
        <Button variant="secondary" onClick={() => void setup.cancel()}>
          取消登录
        </Button>
      )}
      {setup.error && (
        <p className="alert" role="alert">
          {setup.error}
        </p>
      )}
    </section>
  );
}
