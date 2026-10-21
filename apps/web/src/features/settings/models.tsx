import type { EngineId, EngineModel } from "@domos/agent/harness/types";
import { Button, Switch } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../client.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import { useModels } from "../models/use-models.ts";
import { useVisibility } from "../models/use-visibility.ts";
import { userError } from "../user-error.ts";
import { useConnectionContext } from "./use-connection-context.ts";

export function ModelSettings({
  botId,
  admin,
}: {
  botId?: number;
  admin: boolean;
}) {
  const { target, error } = useConnectionContext(botId);
  const pi = useModels(true);
  const visibility = useVisibility(true);
  const [catalog, setCatalog] = useState<
    { id: EngineId; name: string; models: EngineModel[]; error?: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [failure, setFailure] = useState("");
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!target) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setCatalog([]);
    setFailure("");
    try {
      const providers = await client.engines.catalog(undefined, {
        signal: controller.signal,
      });
      for (const provider of providers.filter((item) => item.id !== "pi")) {
        if (controller.signal.aborted) return;
        try {
          const connection = await client.engines.inspect(
            { botId: target.id, provider: provider.id },
            { signal: controller.signal },
          );
          if (!controller.signal.aborted)
            setCatalog((items) => [
              ...items,
              { ...provider, models: connection.models },
            ]);
        } catch (cause) {
          if (!controller.signal.aborted)
            setCatalog((items) => [
              ...items,
              {
                ...provider,
                models: [],
                error: userError(cause, "模型读取失败。"),
              },
            ]);
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setFailure(userError(cause, "引擎目录读取失败。"));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [target]);
  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);
  const groups = [
    {
      id: "pi" as const,
      name: "Pi",
      models: (pi.choices ?? []).map((item) => ({
        id: `${item.provider}/${item.modelId}`,
        name: item.name,
        group: item.providerName,
      })),
      error: pi.error,
    },
    ...catalog,
  ];
  return (
    <div className="settings-sections" aria-busy={visibility.pending}>
      <TextField
        label="搜索模型"
        type="search"
        value={query}
        onValueChange={setQuery}
        placeholder="搜索名称或模型 ID"
      />
      <p className="detail-note">
        控制模型在聊天选择器中的可见性。设置由此服务的设备共用。
      </p>
      {target && (
        <p className="detail-note">
          {target.name} · {target.computer}
        </p>
      )}
      {groups.map((harness) => {
        const models = harness.models.filter((item) =>
          `${item.name} ${item.id} ${item.group ?? ""}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        );
        return (
          <section
            key={harness.id}
            className="settings-group"
            aria-label={`${harness.name} 模型`}
          >
            <h3 className="provider-row">
              <EngineMark provider={harness.id} />
              {harness.name}
            </h3>
            <div className="settings-card">
              {models.map((item, index) => (
                <Fragment key={item.id}>
                  {item.group && item.group !== models[index - 1]?.group && (
                    <h4 className="model-provider-heading">{item.group}</h4>
                  )}
                  <div className="setting-row">
                    <div className="setting-caption">
                      <strong title={item.name}>{item.name}</strong>
                      <span className="detail-note" title={item.id}>
                        {item.id}
                      </span>
                    </div>
                    <Switch
                      label={`${harness.name} · ${item.name}`}
                      checked={visibility.visible(harness.id, item.id)}
                      disabled={!admin || visibility.pending}
                      onCheckedChange={(visible) =>
                        void visibility.save(harness.id, item.id, visible)
                      }
                    />
                  </div>
                </Fragment>
              ))}
              {!models.length && (
                <p className="detail-note model-catalog-empty">
                  {harness.error ?? (query ? "没有匹配的模型" : "尚无可用模型")}
                </p>
              )}
            </div>
          </section>
        );
      })}
      {loading ? (
        <p role="status" className="detail-note">
          正在读取工作电脑的模型…
        </p>
      ) : (
        <Button variant="secondary" size="small" onClick={() => void load()}>
          刷新模型
        </Button>
      )}
      {(error || failure || visibility.error) && (
        <p className="alert" role="alert">
          {error || failure || visibility.error}
        </p>
      )}
    </div>
  );
}
