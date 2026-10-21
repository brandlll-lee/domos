import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { ChoicePicker, SearchPicker } from "@domos/ui/picker";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../../client.ts";
import type { EngineSetup } from "./use-engine.ts";

export function OpenCodeAccount({
  botId,
  setup,
  onConnected,
}: {
  botId: number;
  setup: EngineSetup;
  onConnected: () => void;
}) {
  const [catalog, setCatalog] =
    useState<Awaited<ReturnType<typeof client.engines.accounts>>>();
  const [providerId, setProviderId] = useState("");
  const [method, setMethod] = useState("0");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try {
      setCatalog(
        await client.engines.accounts({ botId, provider: "opencode" }),
      );
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [botId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (setup.login?.state === "done") void load();
  }, [setup.login?.state, load]);
  const selected = catalog?.providers.find((item) => item.id === providerId);
  const connection = selected?.methods[Number(method)];
  const prompts = (connection?.prompts ?? []).filter(
    (prompt) =>
      !prompt.when ||
      (prompt.when.op === "eq"
        ? inputs[prompt.when.key] === prompt.when.value
        : inputs[prompt.when.key] !== prompt.when.value),
  );
  const choose = (id: string) => {
    setProviderId(id);
    setMethod("0");
    setInputs({});
    setKey("");
  };
  if (!catalog)
    return error ? (
      <div className="detail-stack">
        <p className="alert" role="alert">
          {error}
        </p>
        <Button variant="secondary" onClick={() => void load()}>
          重新读取
        </Button>
      </div>
    ) : (
      <p role="status">正在读取服务商…</p>
    );
  return (
    <form
      className="detail-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!selected || !connection) return;
        if (connection.type === "oauth") {
          void setup.signIn({ providerId, method: Number(method), inputs });
          setInputs({});
        } else {
          const value = key;
          setKey("");
          void setup.key(value, providerId).then(async (success) => {
            if (success) {
              await load();
              onConnected();
            }
          });
        }
      }}
    >
      <div className="provider-row">
        <strong>服务商</strong>
        <Button
          variant="secondary"
          size="small"
          disabled={setup.busy}
          onClick={() => {
            choose("");
            setAdding(!adding);
          }}
        >
          {adding ? "返回列表" : "添加提供方"}
        </Button>
      </div>
      {!adding &&
        catalog.providers
          .filter((item) => item.connected)
          .map((item) => (
            <div className="provider-account-row" key={item.id}>
              <span>{item.name}</span>
              <span className="detail-note">已连接</span>
              <Button
                variant="ghost"
                size="small"
                disabled={setup.busy}
                onClick={() => {
                  choose(item.id);
                  setAdding(true);
                }}
              >
                管理
              </Button>
            </div>
          ))}
      {!adding && !catalog.providers.some((item) => item.connected) && (
        <p className="detail-note">尚未连接服务商</p>
      )}
      {adding && (
        <>
          <SearchPicker
            label="模型服务"
            value={providerId}
            placeholder="选择服务商"
            searchLabel="搜索服务商…"
            emptyLabel="没有找到服务商"
            disabled={setup.busy}
            onValueChange={choose}
            items={catalog.providers.map((item) => ({
              value: item.id,
              label: `${item.name}${item.connected ? " · 可用" : ""}`,
            }))}
          />
          {selected?.connected && (
            <p className="detail-note" role="status">
              {selected.name} 已连接
            </p>
          )}
          {selected && (
            <>
              {selected.methods.length > 1 && (
                <ChoicePicker
                  label="连接方式"
                  value={method}
                  onValueChange={(value) => {
                    setMethod(value);
                    setInputs({});
                    setKey("");
                  }}
                  disabled={setup.busy}
                  items={selected.methods.map((item, index) => ({
                    value: String(index),
                    label: item.label,
                  }))}
                />
              )}
              {prompts.map((prompt) =>
                prompt.type === "select" ? (
                  <ChoicePicker
                    key={prompt.key}
                    label={prompt.message}
                    value={inputs[prompt.key] ?? ""}
                    onValueChange={(value) =>
                      setInputs((current) => ({
                        ...current,
                        [prompt.key]: value,
                      }))
                    }
                    disabled={setup.busy}
                    items={[
                      { value: "", label: "请选择" },
                      ...(prompt.options ?? []).map((item) => ({
                        value: item.value,
                        label: item.label,
                      })),
                    ]}
                  />
                ) : (
                  <TextField
                    key={prompt.key}
                    label={prompt.message}
                    placeholder={prompt.placeholder}
                    value={inputs[prompt.key] ?? ""}
                    onValueChange={(value) =>
                      setInputs((current) => ({
                        ...current,
                        [prompt.key]: value,
                      }))
                    }
                    disabled={setup.busy}
                    autoComplete="off"
                  />
                ),
              )}
              {connection?.type === "api" && (
                <TextField
                  label={`${selected.name} API 密钥`}
                  type="password"
                  autoComplete="off"
                  value={key}
                  onValueChange={setKey}
                  disabled={setup.busy}
                  description="保存在工作电脑的 Domos 专用目录。"
                />
              )}
              <Button
                pending={setup.pending === "key" || setup.pending === "login"}
                disabled={
                  setup.busy ||
                  !connection ||
                  (connection.type === "api" && !key.trim()) ||
                  prompts.some((prompt) => !inputs[prompt.key]?.trim())
                }
              >
                {connection?.type === "oauth"
                  ? `登录 ${selected.name}`
                  : "连接"}
              </Button>
            </>
          )}
        </>
      )}
    </form>
  );
}
