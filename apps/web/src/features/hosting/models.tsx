import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { ScrollArea } from "@domos/ui/scroll-area";
import { CheckIcon as Check } from "@phosphor-icons/react/dist/csr/Check";
import { CircleNotchIcon as LoaderCircle } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { PlusIcon as Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { useState } from "react";
import { client } from "../../client.ts";
import { PiAccountFlow } from "./model-account-flow.tsx";
import { useModelAccount } from "./use-model-account.ts";
import "./models.css";

export function HostingModels({
  onConfigured,
  botId,
  model,
  onBusyChange,
}: {
  onConfigured?: () => void | Promise<void>;
  botId?: number;
  model?: string | null;
  onBusyChange?: (busy: boolean) => void;
}) {
  const separator = model?.indexOf("/") ?? -1;
  const initialProvider =
    model && separator > 0 ? model.slice(0, separator) : "";
  const account = useModelAccount(onBusyChange, initialProvider);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [selectingModel, setSelectingModel] = useState("");
  const { catalog, provider, selected, busy, waiting } = account;
  const configuredProviders =
    catalog?.providers.filter((item) => item.configured) ?? [];
  const models = (catalog?.models ?? []).filter(
    (item) => item.provider === provider,
  );
  const visibleModels = models.filter((item) =>
    `${item.name} ${item.modelId}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );

  function chooseProvider(value: string) {
    account.setProvider(value);
    setAdding(false);
    setQuery("");
  }

  function addProvider() {
    if (adding) {
      setAdding(false);
      account.setProvider(initialProvider || configuredProviders[0]?.id || "");
      return;
    }
    account.setProvider("");
    setAdding(true);
    setQuery("");
  }

  async function chooseModel(item: (typeof models)[number]) {
    if (botId === undefined) return;
    setSelectingModel(item.modelId);
    await account.action(async () => {
      await client.models.select({
        botId,
        provider: item.provider,
        modelId: item.modelId,
      });
      window.dispatchEvent(new Event("domos:models"));
      await onConfigured?.();
    });
    setSelectingModel("");
  }

  return (
    <section
      className="hosting-models"
      aria-label="模型配置"
      aria-busy={busy || waiting}
    >
      <aside className="hosting-model-rail">
        <span className="hosting-model-rail-label">已连接</span>
        <ScrollArea
          className="hosting-model-rail-scroll"
          viewportClassName="hosting-model-rail-viewport"
        >
          <fieldset
            className="hosting-model-provider-list"
            aria-label="已连接的模型提供方"
          >
            {configuredProviders.map((item) => (
              <button
                key={item.id}
                type="button"
                className="hosting-model-provider"
                aria-pressed={provider === item.id}
                disabled={busy || waiting}
                onClick={() => chooseProvider(item.id)}
                title={item.name}
              >
                <span className="hosting-model-provider-name">{item.name}</span>
                {provider === item.id && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
            {catalog && configuredProviders.length === 0 && (
              <p className="hosting-model-rail-note">尚未连接提供方</p>
            )}
          </fieldset>
        </ScrollArea>
        <Button
          className="hosting-model-add"
          variant={adding ? "secondary" : "ghost"}
          size="small"
          disabled={!catalog || busy || waiting}
          aria-pressed={adding}
          onClick={addProvider}
        >
          <Plus size={15} aria-hidden="true" />
          添加提供方
        </Button>
      </aside>

      <div className="hosting-model-main">
        <header className="hosting-model-header">
          <strong>
            {selected?.name ?? (adding ? "添加提供方" : "模型列表")}
          </strong>
          {selected?.configured && (
            <span className="hosting-model-status">已连接</span>
          )}
        </header>
        {!catalog ? (
          <p className="detail-note" role="status">
            正在读取账号…
          </p>
        ) : (
          <>
            <PiAccountFlow
              key={provider}
              account={account}
              adding={adding}
              onAddingChange={setAdding}
            />
            {selected?.configured && (
              <div className="hosting-model-catalog">
                <TextField
                  label="搜索模型"
                  type="search"
                  value={query}
                  onValueChange={setQuery}
                  placeholder="输入模型名称或 ID"
                  disabled={busy || waiting}
                />
                <ScrollArea
                  className="hosting-model-list-scroll"
                  viewportClassName="hosting-model-list-viewport"
                >
                  {visibleModels.length ? (
                    <fieldset
                      className="hosting-model-list"
                      aria-label="可用模型"
                    >
                      {visibleModels.map((item) => {
                        const current =
                          `${item.provider}/${item.modelId}` === model;
                        const pending = selectingModel === item.modelId;
                        const content = (
                          <>
                            <span className="hosting-model-option-copy">
                              <span className="hosting-model-option-name">
                                {item.name}
                              </span>
                              <span className="hosting-model-option-id">
                                {item.modelId}
                              </span>
                            </span>
                            {pending ? (
                              <LoaderCircle
                                className="hosting-model-spinner"
                                size={15}
                                aria-label="正在保存"
                              />
                            ) : (
                              current && <Check size={15} aria-hidden="true" />
                            )}
                          </>
                        );

                        return botId === undefined ? (
                          <div
                            key={`${item.provider}/${item.modelId}`}
                            className="hosting-model-option"
                            aria-current={current ? "true" : undefined}
                          >
                            {content}
                          </div>
                        ) : (
                          <button
                            key={`${item.provider}/${item.modelId}`}
                            type="button"
                            className="hosting-model-option"
                            aria-pressed={current}
                            disabled={busy || waiting}
                            onClick={() => void chooseModel(item)}
                          >
                            {content}
                          </button>
                        );
                      })}
                    </fieldset>
                  ) : (
                    <p className="detail-note hosting-model-empty">
                      {query ? "没有找到模型" : "没有可用模型"}
                    </p>
                  )}
                </ScrollArea>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
