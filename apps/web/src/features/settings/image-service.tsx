import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { PanelGroup } from "@domos/ui/panel";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";
import { Attachments } from "../chat/attachments.tsx";
import { userError } from "../user-error.ts";
import { useImageSettings } from "./image-state.ts";

type Settings = Awaited<ReturnType<typeof client.images.state>>;
export function ImageServiceSettings({
  botId,
  admin,
  enabled,
}: {
  botId: number;
  admin: boolean;
  enabled: boolean;
}) {
  const { store, data, error, pending } = useImageSettings(botId);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (enabled) void store.load();
  }, [store, enabled]);
  return (
    <PanelGroup title="图像生成">
      <SettingRow
        title={data?.name ?? "图像生成"}
        description={
          !enabled
            ? "等待工作电脑授权"
            : (error ??
              (data
                ? data.configured
                  ? "已配置 · Flare / Sunburst"
                  : "待配置"
                : "正在读取服务"))
        }
      >
        <Button
          variant="secondary"
          size="small"
          disabled={!enabled}
          onClick={() => setOpen(!open)}
        >
          {open ? "收起" : admin ? "设置图像生成" : "查看"}
        </Button>
      </SettingRow>
      {open && (
        <>
          {pending && !data && <Loading label="正在读取图像服务" inline />}
          {error && (
            <SettingRow title="读取失败">
              <Button
                variant="ghost"
                size="small"
                onClick={() => void store.load(true)}
              >
                重试
              </Button>
            </SettingRow>
          )}
          {data && (
            <ImageServiceForm
              key={`${data.computerId}:${data.revision}`}
              botId={botId}
              data={data}
              admin={admin}
              onSaved={store.receive}
            />
          )}
        </>
      )}
    </PanelGroup>
  );
}
function ImageServiceForm({
  botId,
  data,
  admin,
  onSaved,
}: {
  botId: number;
  data: Settings;
  admin: boolean;
  onSaved: (data: Settings) => void;
}) {
  const [form, setForm] = useState(data);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [results, setResults] =
    useState<Awaited<ReturnType<typeof client.images.preview>>>();
  const [trial, setTrial] = useState<{
    requestId: string;
    animated: boolean;
  }>();
  const changed =
    JSON.stringify(form) !== JSON.stringify(data) || Boolean(apiKey);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(userError(error, "图像服务操作未完成。"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const saved = await client.images.save({
            ...form,
            botId,
            apiKey: apiKey || undefined,
          });
          setApiKey("");
          onSaved(saved);
        });
      }}
      aria-busy={busy}
    >
      <fieldset className="image-service-fields" disabled={!admin || busy}>
        <SettingRow title="服务名称">
          <TextField
            label="服务名称"
            labelClassName="sr-only"
            value={form.name}
            onValueChange={(name) => setForm({ ...form, name })}
            required
            maxLength={80}
          />
        </SettingRow>
        <SettingRow title="Base URL">
          <TextField
            label="图像服务 Base URL"
            labelClassName="sr-only"
            value={form.baseUrl}
            onValueChange={(baseUrl) => setForm({ ...form, baseUrl })}
            required
          />
        </SettingRow>
        <SettingRow
          title="API Key"
          description={
            data.configured
              ? "已配置；留空保留原密钥。"
              : "加密保存，仅用于图像服务。"
          }
        >
          <TextField
            label="图像服务 API Key"
            labelClassName="sr-only"
            type="password"
            value={apiKey}
            onValueChange={setApiKey}
            autoComplete="new-password"
          />
        </SettingRow>
        <SettingRow title="默认模型">
          <ChoicePicker
            label="默认图像模型"
            value={form.model}
            items={[
              { value: "gpt-image-2.6-flare", label: "GPT Image 2.6 Flare" },
              {
                value: "gpt-image-2.6-sunburst",
                label: "GPT Image 2.6 Sunburst",
              },
            ]}
            onValueChange={(value) =>
              setForm({ ...form, model: value as Settings["model"] })
            }
          />
        </SettingRow>
        {(
          [
            ["quality", "画质"],
            ["complexity", "规划强度"],
          ] as const
        ).map(([field, label]) => (
          <SettingRow key={field} title={label}>
            <ChoicePicker
              label={label}
              value={form[field]}
              items={[
                { value: "low", label: "低" },
                { value: "medium", label: "中" },
                { value: "high", label: "高" },
              ]}
              onValueChange={(value) =>
                setForm({ ...form, [field]: value as Settings[typeof field] })
              }
            />
          </SettingRow>
        ))}
        <SettingRow
          title="连接检查"
          description="检查认证和模型目录；不会生成图片或验证 GIF。"
        >
          <Button
            type="button"
            variant="secondary"
            size="small"
            disabled={changed || !data.configured}
            onClick={() =>
              void run(async () => {
                const result = await client.images.test({ botId });
                setNotice(
                  result.models.length
                    ? `连接可用：${result.models.join("、")}。GIF 尚需试生成验证。`
                    : "认证成功，但服务未列出受支持的模型。",
                );
              })
            }
          >
            检查连接
          </Button>
          <Button type="submit" size="small" pending={busy} disabled={!changed}>
            保存图像服务
          </Button>
        </SettingRow>
        <SettingRow
          title="试生成"
          description="调用已保存的模型，会消耗供应商额度。动画测试同时验证透明处理。"
        >
          {[false, true].map((animated) => (
            <Button
              key={String(animated)}
              type="button"
              variant="secondary"
              size="small"
              disabled={changed || !data.configured}
              onClick={() => {
                const request =
                  trial?.animated === animated
                    ? trial
                    : { requestId: crypto.randomUUID(), animated };
                setTrial(request);
                void run(async () => {
                  setResults(
                    await client.images.preview({ botId, ...request }),
                  );
                  setTrial(undefined);
                  setNotice("试生成完成。");
                });
              }}
            >
              {animated ? "试生成动图" : "试生成图片"}
            </Button>
          ))}
        </SettingRow>
      </fieldset>
      {notice && (
        <SettingRow title="结果">
          <InlineNotice>{notice}</InlineNotice>
        </SettingRow>
      )}
      {results && (
        <SettingRow title="预览">
          <Attachments
            botId={botId}
            files={results.map((result) => result.file)}
          />
        </SettingRow>
      )}
    </form>
  );
}
