import { Button, Switch } from "@domos/ui/controls";
import { SearchField } from "@domos/ui/field";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import { useVisibility } from "../models/use-visibility.ts";
import { useConnectionContext } from "./use-connection-context.ts";

export function ModelSettings({
  botId,
  admin,
}: {
  botId?: number;
  admin: boolean;
}) {
  const { target, error: targetError } = useConnectionContext(botId);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<
    Awaited<ReturnType<typeof client.engines.models>>
  >([]);
  const visibility = useVisibility(true);
  const [query, setQuery] = useState("");
  const load = useCallback(async () => {
    if (!target) return;
    try {
      setGroups(await client.engines.models({ botId: target.id }));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "模型目录读取失败。");
    }
  }, [target]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div
      className="settings-sections model-catalog"
      aria-busy={visibility.pending}
    >
      <SearchField
        aria-label="搜索模型"
        value={query}
        onValueChange={setQuery}
        placeholder="搜索名称或模型 ID"
      />
      {groups
        .filter((harness) => harness.models.length)
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
                    {query ? "没有匹配的模型" : "尚无可用模型"}
                  </p>
                )}
              </div>
            </details>
          );
        })}
      {!groups.some((harness) => harness.models.length) && (
        <p className="detail-note">还没有模型目录。点击刷新模型。</p>
      )}
      <Button variant="secondary" size="small" onClick={load}>
        刷新模型
      </Button>
      {(error || targetError || visibility.error) && (
        <p className="alert" role="alert">
          {error || targetError || visibility.error}
        </p>
      )}
    </div>
  );
}
