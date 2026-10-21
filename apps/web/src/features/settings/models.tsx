import type { EngineId, EngineModel } from "@domos/agent/harness/types";
import { Button, Switch } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const load = useCallback(
    async (refresh = false) => {
      if (!target) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      setFailure("");
      try {
        if (!refresh) {
          const value = await client.engines.models(
            { botId: target.id },
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) setCatalog(value);
          return;
        }
        window.dispatchEvent(new Event("domos:models"));
        const providers = await client.engines.catalog(undefined, {
          signal: controller.signal,
        });
        const next: typeof catalog = [];
        for (const provider of providers.filter((item) => item.id !== "pi")) {
          if (controller.signal.aborted) return;
          try {
            const connection = await client.engines.inspect(
              { botId: target.id, provider: provider.id, refresh: true },
              { signal: controller.signal },
            );
            if (!controller.signal.aborted)
              next.push({ ...provider, models: connection.models });
          } catch (cause) {
            if (!controller.signal.aborted)
              next.push({
                ...provider,
                models: [],
                error: userError(cause, "模型读取失败。"),
              });
          }
        }
        if (!controller.signal.aborted) {
          setCatalog(next);
          window.dispatchEvent(
            new CustomEvent("domos:engines", { detail: "models" }),
          );
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setFailure(userError(cause, "引擎目录读取失败。"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [target],
  );
  useEffect(() => {
    void load();
    const refresh = (event: Event) => {
      if ((event as CustomEvent).detail !== "models") void load();
    };
    window.addEventListener("domos:engines", refresh);
    return () => {
      request.current?.abort();
      window.removeEventListener("domos:engines", refresh);
    };
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
    <div
      className="settings-sections model-catalog"
      aria-busy={visibility.pending || loading}
    >
      <TextField
        label="搜索模型"
        type="search"
        value={query}
        onValueChange={setQuery}
        placeholder="搜索名称或模型 ID"
      />
      {groups
        .filter((harness) => harness.models.length || harness.error)
        .map((harness) => {
          const models = harness.models.filter((item) =>
            `${item.name} ${item.id} ${item.group ?? ""}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          );
          return (
            <details
              open
              key={harness.id}
              className="settings-group"
              aria-label={`${harness.name} 模型`}
            >
              <summary className="provider-row">
                <CaretRightIcon className="model-catalog-chevron" />
                <EngineMark provider={harness.id} />
                {harness.name}
                <span className="detail-note">{models.length}</span>
              </summary>
              <div className="model-catalog-list">
                {models.map((item, index) => (
                  <div key={item.id}>
                    {item.group && item.group !== models[index - 1]?.group && (
                      <h4 className="model-provider-heading">{item.group}</h4>
                    )}
                    <div className="setting-row">
                      <div className="setting-caption">
                        <span title={`${item.name} (${item.id})`}>
                          {item.name}
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
                  </div>
                ))}
                {!models.length && (
                  <p className="detail-note model-catalog-empty">
                    {harness.error ??
                      (query ? "没有匹配的模型" : "尚无可用模型")}
                  </p>
                )}
              </div>
            </details>
          );
        })}
      {!groups.some((harness) => harness.models.length) && !loading && (
        <p className="detail-note">还没有模型目录。点击刷新模型。</p>
      )}
      {loading ? (
        <p role="status" className="detail-note">
          正在读取工作电脑的模型…
        </p>
      ) : (
        <Button
          variant="secondary"
          size="small"
          onClick={() => void load(true)}
        >
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
