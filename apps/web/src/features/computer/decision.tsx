import { SegmentedControl } from "@domos/ui/choice";
import { Button, Switch } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { PanelGroup } from "@domos/ui/panel";
import { SettingRow } from "@domos/ui/setting-row";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { userError } from "../user-error.ts";

export function ComputerDecision({
  botId,
  admin,
  configuring,
  onConfigure,
}: {
  botId: number;
  admin: boolean;
  configuring: boolean;
  onConfigure: () => void;
}) {
  const [state, setState] =
    useState<Awaited<ReturnType<typeof client.computer.assistant>>>();
  const [key, setKey] = useState("");
  const [action, setAction] = useState<
    "configure" | "save" | "test" | "remove"
  >();
  const busy = Boolean(action);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void client.computer
      .assistant({ botId }, { signal: controller.signal })
      .then(setState)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(userError(cause, "无法读取辅助决策设置。"));
      });
    return () => controller.abort();
  }, [botId]);
  const provider = state?.provider ?? "typesafe";
  const configured = state?.configured[provider] ?? false;
  const disabled = !admin || busy || !state?.available;
  async function run(
    name: NonNullable<typeof action>,
    execute: () => Promise<void>,
  ) {
    setAction(name);
    setError("");
    setResult("");
    try {
      await execute();
    } catch (cause) {
      setError(userError(cause, "辅助决策设置未完成。"));
    } finally {
      setAction(undefined);
    }
  }
  async function configure(enabled: boolean, source = provider) {
    if (!state?.computerId) return;
    setState(
      await client.computer.assistantConfigure({
        botId,
        computerId: state.computerId,
        revision: state.revision,
        enabled,
        provider: source,
      }),
    );
    setKey("");
  }
  return (
    <div className="panel-page" aria-busy={busy}>
      {!state && !error && <Loading label="正在读取辅助操作" />}
      {!configuring ? (
        <PanelGroup title="辅助操作">
          <SettingRow
            title="Jev 辅助操作"
            description={
              state
                ? `${state.enabled ? "已启用" : "未启用"} · ${provider === "typesafe" ? "官方" : "OpenRouter"} · ${configured ? "已配置密钥" : "未配置密钥"}`
                : "读取中"
            }
            notice={
              state && !state.available
                ? "当前服务未配置凭据存储。"
                : "启用后，必要的界面文字或截图会发送至所选服务。"
            }
          >
            <Button
              variant="ghost"
              size="small"
              disabled={busy}
              onClick={onConfigure}
            >
              配置
            </Button>
            <Switch
              label="启用辅助决策"
              checked={state?.enabled ?? false}
              disabled={disabled || (!configured && !state?.enabled)}
              onCheckedChange={(enabled) =>
                void run("configure", () => configure(enabled))
              }
            />
          </SettingRow>
        </PanelGroup>
      ) : (
        <>
          <PanelGroup title="服务">
            <SettingRow
              title="来源"
              notice="启用后，必要的界面文字或截图会发送至所选服务。"
            >
              <SegmentedControl
                label="Jev 来源"
                value={provider}
                disabled={disabled}
                options={[
                  { value: "typesafe", label: "官方" },
                  { value: "openrouter", label: "OpenRouter" },
                ]}
                onValueChange={(value) =>
                  void run("configure", () => configure(false, value))
                }
              />
            </SettingRow>
            <SettingRow title="密钥状态">
              <span className="status-label" role="status">
                {state ? (configured ? "已配置" : "未配置") : "读取中"}
              </span>
            </SettingRow>
          </PanelGroup>
          {admin && state?.available && (
            <PanelGroup title="凭据">
              <form
                className="settings-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = key.trim();
                  setKey("");
                  void run("save", async () =>
                    setState(
                      await client.computer.assistantKey({
                        botId,
                        provider,
                        key: value,
                      }),
                    ),
                  );
                }}
              >
                <TextField
                  label={`${provider === "typesafe" ? "TypeSafe" : "OpenRouter"} API 密钥`}
                  type="password"
                  autoComplete="off"
                  maxLength={512}
                  value={key}
                  onValueChange={setKey}
                  placeholder={configured ? "已保存" : "输入密钥"}
                  description="密钥加密保存在此 Domos 服务中。"
                  disabled={busy}
                />
                <div className="form-actions">
                  <Button
                    size="small"
                    variant="secondary"
                    type="submit"
                    pending={action === "save"}
                    disabled={busy || !key.trim()}
                  >
                    保存密钥
                  </Button>
                  <Button
                    size="small"
                    variant="secondary"
                    type="button"
                    pending={action === "test"}
                    disabled={busy || !configured}
                    onClick={() =>
                      void run("test", async () => {
                        const test = await client.computer.assistantTest({
                          botId,
                          provider,
                        });
                        setResult(`已连接 · ${test.milliseconds} ms`);
                      })
                    }
                  >
                    测试连接
                  </Button>
                  {configured && (
                    <Button
                      size="small"
                      variant="ghost"
                      type="button"
                      pending={action === "remove"}
                      disabled={busy}
                      onClick={() =>
                        void run("remove", async () =>
                          setState(
                            await client.computer.assistantKey({
                              botId,
                              provider,
                              key: "",
                            }),
                          ),
                        )
                      }
                    >
                      移除密钥
                    </Button>
                  )}
                </div>
                {result && (
                  <div role="status">
                    <InlineNotice>{result}</InlineNotice>
                  </div>
                )}
              </form>
            </PanelGroup>
          )}
          {state && !state.available && (
            <InlineNotice>当前服务未配置凭据存储。</InlineNotice>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
    </div>
  );
}
