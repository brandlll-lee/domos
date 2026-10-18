import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { SearchPicker } from "@domos/ui/picker";
import { type ReactNode, useEffect, useState } from "react";
import { HostingModels } from "../../hosting/models.tsx";
import { EngineSelect } from "../engine-select.tsx";
import { EngineAccount } from "./engine-account.tsx";
import { type EngineSetup, useEngine } from "./use-engine.ts";

export function EnginePanel({
  botId,
  active = true,
  canManage = false,
  piModel,
  onReady,
}: {
  botId: number;
  active?: boolean;
  canManage?: boolean;
  piModel?: ReactNode;
  onReady?: () => void;
}) {
  const setup = useEngine(botId, active);
  const { profile, connection, busy, error } = setup;
  const provider = profile?.config.provider;
  return (
    <section className="detail-stack engine-panel" aria-label="任务引擎">
      {!onReady && (
        <header>
          <h3>任务引擎</h3>
          <p className="detail-note">更换后开始新会话，聊天记录会保留。</p>
        </header>
      )}
      {profile && (
        <EngineSelect
          value={profile.config.provider}
          disabled={busy}
          onChange={(provider) => void setup.save({ provider, model: null })}
        />
      )}
      <div className="settings-card">
        <div className="setting-row">
          <div>
            <strong>工作电脑上的引擎</strong>
            <p className="detail-note" role="status">
              {connection
                ? connection.authenticated
                  ? connection.message
                  : "已安装。请连接账号。"
                : profile?.prepared
                  ? "已就绪"
                  : "检查后继续。"}
            </p>
          </div>
          <Button
            variant="secondary"
            size="small"
            disabled={busy || !profile}
            onClick={() => void setup.inspect()}
          >
            {busy ? "正在处理…" : "检查连接"}
          </Button>
        </div>
        {canManage && provider && provider !== "pi" && !connection && (
          <details
            className="engine-account-options"
            open={Boolean(error) || undefined}
          >
            <summary>尚未安装？</summary>
            <p className="detail-note">
              仅在所选工作电脑下载和安装。需要允许联网。
            </p>
            <div className="form-actions">
              <Button
                variant="secondary"
                size="small"
                disabled={busy}
                onClick={() => void setup.install()}
              >
                在工作电脑安装
              </Button>
            </div>
          </details>
        )}
      </div>
      {provider === "pi"
        ? (piModel ??
          (canManage ? (
            <HostingModels
              botId={botId}
              onConfigured={() => void setup.refresh()}
            />
          ) : (
            <p className="detail-note">请让管理员连接模型账号。</p>
          )))
        : provider && (
            <EngineAccount
              key={provider}
              provider={provider}
              setup={setup}
              canManage={canManage}
            />
          )}
      {provider && provider !== "pi" && <EngineModel setup={setup} />}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {onReady && (
        <Button disabled={busy || !profile?.prepared} onClick={onReady}>
          开始使用
        </Button>
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
    <details className="engine-model">
      <summary>模型 · {profile.config.model || "自动选择"}</summary>
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
