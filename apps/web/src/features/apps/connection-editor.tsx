import { SegmentedControl } from "@domos/ui/choice";
import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { ChoicePicker } from "@domos/ui/picker";
import { useState } from "react";
import type { client } from "../../client.ts";
import { appsCopy } from "./copy.ts";

export type Draft = {
  id: string;
  revision: number;
  name: string;
  computerId: string;
  enabled: boolean;
  paste: string;
  transport: "http" | "stdio";
  address: string;
  args: string;
  settings: string;
  editing: boolean;
};

export function ConnectionEditor({
  form,
  appInfo,
  computers,
  step,
  onManual,
  busy,
  change,
  onSave,
}: {
  form: Draft;
  appInfo?: Awaited<ReturnType<typeof client.mcp.catalog>>[number];
  computers: { id: string; name: string }[];
  step: "import" | "confirm";
  onManual: () => void;
  busy: boolean;
  change: (value: Partial<Draft>) => void;
  onSave: () => void;
}) {
  return (
    <form
      id="connection-editor"
      className="form-fields"
      onSubmit={(event) => {
        event.preventDefault();
        if (step === "confirm") onSave();
      }}
    >
      {step === "import" ? (
        <>
          <label className="field">
            <span className="field-label">MCP 地址或配置</span>
            <textarea
              className="field-control"
              rows={1}
              value={form.paste}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => change({ paste: event.target.value })}
              placeholder="https://example.com/mcp"
            />
          </label>
          <div className="connection-import-actions">
            <span className="field-description">
              也支持 JSON 配置和 MCP 添加命令
            </span>
            <Button
              type="button"
              size="small"
              variant="ghost"
              onClick={onManual}
            >
              手动配置
            </Button>
          </div>
        </>
      ) : (
        <>
          {appInfo && (
            <p>
              {appInfo.preparation}{" "}
              <a href={appInfo.documentation} target="_blank" rel="noreferrer">
                官方说明
              </a>
            </p>
          )}
          <label className="field">
            <span className="field-label">名称</span>
            <input
              className="field-control"
              required
              disabled={busy}
              value={form.name}
              onChange={(event) => change({ name: event.target.value })}
            />
          </label>
          <div className="field">
            <label className="field-label" htmlFor="connection-computer">
              运行／访问电脑
            </label>
            <ChoicePicker
              id="connection-computer"
              label="运行／访问电脑"
              placeholder="选择电脑"
              required
              disabled={busy}
              value={form.computerId}
              items={computers.map((pc) => ({ value: pc.id, label: pc.name }))}
              onValueChange={(computerId) => change({ computerId })}
            />
          </div>
          <SegmentedControl
            label="传输方式"
            value={form.transport}
            disabled={busy}
            options={[
              { value: "http", label: "HTTP / SSE" },
              { value: "stdio", label: "本地命令" },
            ]}
            onValueChange={(transport) => change({ transport })}
          />
          <label className="field">
            <span className="field-label">
              {form.transport === "http" ? "MCP 地址" : "启动程序"}
            </span>
            <input
              className="field-control"
              required={!form.editing}
              disabled={busy}
              autoComplete="off"
              type={form.transport === "http" ? "url" : "text"}
              value={form.address}
              onChange={(event) => change({ address: event.target.value })}
            />
          </label>
          {form.editing && (
            <p className="field-description">{appsCopy.secretHint}</p>
          )}
          <Disclosure label="高级设置">
            <div className="form-fields">
              {form.transport === "stdio" && (
                <label className="field">
                  <span className="field-label">参数（JSON 数组）</span>
                  <textarea
                    className="field-control"
                    disabled={busy}
                    value={form.args}
                    onChange={(event) => change({ args: event.target.value })}
                  />
                </label>
              )}
              <ConnectionSecrets
                key={form.id}
                settings={form.settings}
                transport={form.transport}
                disabled={busy}
                onChange={(settings) => change({ settings })}
              />
            </div>
          </Disclosure>
        </>
      )}
    </form>
  );
}

function ConnectionSecrets({
  settings,
  transport,
  disabled,
  onChange,
}: {
  settings: string;
  transport: Draft["transport"];
  disabled: boolean;
  onChange: (settings: string) => void;
}) {
  const [rows, setRows] = useState<
    { id: string; key: string; value: string }[]
  >(() =>
    Object.entries(JSON.parse(settings) as Record<string, string>).map(
      ([key, value]) => ({ id: crypto.randomUUID(), key, value }),
    ),
  );
  const label = transport === "http" ? "请求头" : "环境变量";
  const update = (next: { id: string; key: string; value: string }[]) => {
    setRows(next);
    onChange(
      JSON.stringify(
        Object.fromEntries(
          next
            .filter(({ key }) => key.trim())
            .map(({ key, value }) => [key, value]),
        ),
      ),
    );
  };
  return (
    <fieldset className="connection-secrets" disabled={disabled}>
      <legend className="field-label">{label}</legend>
      {rows.map(({ id, key, value }, index) => (
        <div className="connection-secret-row" key={id}>
          <input
            className="field-control"
            aria-label={`${label}名称 ${index + 1}`}
            placeholder="名称"
            autoComplete="off"
            value={key}
            required={!!value}
            ref={(node) => {
              node?.setCustomValidity(
                key && rows.filter((row) => row.key === key).length > 1
                  ? "名称不能重复。"
                  : "",
              );
            }}
            onChange={(event) =>
              update(
                rows.map((row, i) =>
                  i === index ? { ...row, key: event.target.value } : row,
                ),
              )
            }
          />
          <input
            className="field-control"
            aria-label={`${label}值 ${index + 1}`}
            placeholder="值"
            type="password"
            autoComplete="new-password"
            value={value}
            onChange={(event) =>
              update(
                rows.map((row, i) =>
                  i === index ? { ...row, value: event.target.value } : row,
                ),
              )
            }
          />
          <Button
            type="button"
            size="icon-small"
            variant="ghost"
            aria-label={`删除${label} ${index + 1}`}
            onClick={() => update(rows.filter((_, i) => i !== index))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="small"
        variant="ghost"
        onClick={() =>
          update([...rows, { id: crypto.randomUUID(), key: "", value: "" }])
        }
      >
        ＋ 添加{label}
      </Button>
    </fieldset>
  );
}
