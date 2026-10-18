import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { SearchPicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { type ReactNode, useEffect, useState } from "react";
import { ModelPicker } from "../../chat/model-picker.tsx";
import { HostingModels } from "../../hosting/models.tsx";
import { useSettings } from "../../settings/context.ts";
import { EngineSelect } from "../engine-select.tsx";
import { EngineAccount } from "./engine-account.tsx";
import { type EngineSetup, useEngine } from "./use-engine.ts";
import "./engine.css";

export function EnginePanel({
  botId,
  active = true,
  canManage = false,
  piModel,
  onReady,
  onBack,
  onBusyChange,
}: {
  botId: number;
  active?: boolean;
  canManage?: boolean;
  piModel?: ReactNode;
  onReady?: () => void;
  onBack?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const setup = useEngine(botId, active);
  const settings = useSettings();
  const { profile, connection, busy, error } = setup;
  const provider = profile?.config.provider;
  const model = profile?.config.model;
  const separator = model?.indexOf("/") ?? -1;
  const selection =
    model && separator > 0
      ? {
          provider: model.slice(0, separator),
          modelId: model.slice(separator + 1),
        }
      : null;
  const [modelBusy, setModelBusy] = useState(false);
  const blocked = Boolean(busy || modelBusy);
  useEffect(() => onBusyChange?.(blocked), [blocked, onBusyChange]);
  const status =
    setup.login?.state === "waiting"
      ? "等待登录"
      : profile?.prepared
        ? "已就绪"
        : connection?.authenticated
          ? "已连接"
          : "待连接";
  return (
    <section
      className="engine-panel"
      aria-label="任务引擎"
      aria-busy={Boolean(setup.pending)}
    >
      {!onReady && (
        <header>
          <h3>任务引擎</h3>
          <p className="detail-note">更换后开始新会话，聊天记录会保留。</p>
        </header>
      )}
      {profile && (
        <EngineSelect
          value={profile.config.provider}
          disabled={blocked}
          presentation={onReady ? "list" : "menu"}
          status={status}
          onChange={(provider) => void setup.save({ provider, model: null })}
        />
      )}
      <div className="settings-card">
        <SettingRow
          title="连接状态"
          description={
            connection
              ? connection.authenticated
                ? connection.message
                : "已安装。请连接账号。"
              : profile?.prepared
                ? "已就绪"
                : "连接账号后，检查是否可以开始工作。"
          }
        >
          <Button
            variant="secondary"
            size="small"
            disabled={blocked}
            pending={setup.pending === "inspect"}
            onClick={() => void setup.inspect()}
          >
            {setup.pending === "inspect" ? "正在检查…" : "检查连接"}
          </Button>
        </SettingRow>
        {canManage && provider && provider !== "pi" && !connection && (
          <details
            className="engine-account-options"
            open={Boolean(error) || undefined}
          >
            <summary>安装引擎</summary>
            <p className="detail-note">
              仅在所选工作电脑下载和安装。需要允许联网。
            </p>
            <div className="form-actions">
              <Button
                variant="secondary"
                size="small"
                disabled={busy}
                pending={setup.pending === "install"}
                onClick={() => void setup.install()}
              >
                {setup.pending === "install" ? "正在安装…" : "在工作电脑安装"}
              </Button>
            </div>
          </details>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {provider && provider !== "pi" && (
          <EngineAccount
            key={provider}
            provider={provider}
            setup={setup}
            canManage={canManage}
          />
        )}
      </div>
      {provider === "pi"
        ? (piModel ??
          (canManage && !settings.standalone ? (
            <HostingModels
              botId={botId}
              onConfigured={() => void setup.refresh()}
              onBusyChange={setModelBusy}
            />
          ) : (
            <ModelPicker
              botId={botId}
              model={selection}
              connected={Boolean(profile)}
              onSelected={setup.refresh}
              onBusyChange={setModelBusy}
            />
          )))
        : null}
      {provider && provider !== "pi" && <EngineModel setup={setup} />}
      {onReady && (
        <footer className="engine-footer">
          {!profile?.prepared && (
            <p className="detail-note">连接账号并完成检查后，即可开始使用。</p>
          )}
          <div className="setup-actions">
            {onBack && (
              <Button variant="secondary" disabled={blocked} onClick={onBack}>
                返回
              </Button>
            )}
            <Button disabled={blocked || !profile?.prepared} onClick={onReady}>
              开始使用
            </Button>
          </div>
        </footer>
      )}
    </section>
  );
}

function EngineModel({ setup }: { setup: EngineSetup }) {
  const [model, setModel] = useState("");
  const { profile, connection, busy } = setup;
  useEffect(
    () => setModel(profile?.config.model ?? ""),
    [profile?.config.model],
  );
  if (!profile) return null;
  const save = (value: string) =>
    setup.save({
      provider: profile.config.provider,
      model: value.trim() || null,
    });
  return (
    <details className="engine-model" key={profile.config.provider}>
      <summary>高级选项 · 模型</summary>
      {connection?.models.length ? (
        <SearchPicker
          label="引擎模型"
          value={model}
          searchLabel="搜索模型…"
          emptyLabel="没有找到模型"
          placeholder="使用引擎默认模型"
          items={[
            { value: "", label: "使用引擎默认模型" },
            ...connection.models.map(({ id, name }) => ({
              value: id,
              label: name,
            })),
          ]}
          disabled={busy}
          onValueChange={(value) => void save(value)}
        />
      ) : (
        <form
          className="detail-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save(model);
          }}
        >
          <TextField
            label="模型（可选）"
            value={model}
            onValueChange={setModel}
            disabled={busy}
            placeholder="留空使用引擎默认模型"
          />
          <div className="form-actions">
            <Button
              size="small"
              variant="secondary"
              disabled={busy || model === (profile.config.model ?? "")}
            >
              保存模型
            </Button>
          </div>
        </form>
      )}
    </details>
  );
}
