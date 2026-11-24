import { SegmentedControl } from "@domos/ui/choice";
import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { ChoicePicker } from "@domos/ui/picker";
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
              rows={5}
              value={form.paste}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => change({ paste: event.target.value })}
              placeholder="URL、mcpServers JSON 或支持的 MCP 添加命令"
            />
          </label>
          <Button type="button" variant="ghost" onClick={onManual}>
            手动配置
          </Button>
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
              <label className="field">
                <span className="field-label">
                  {form.transport === "http"
                    ? "请求头（JSON，可填写 Key / Token）"
                    : "环境变量（JSON）"}
                </span>
                <textarea
                  className="field-control"
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                  value={form.settings}
                  onChange={(event) => change({ settings: event.target.value })}
                />
              </label>
            </div>
          </Disclosure>
        </>
      )}
    </form>
  );
}
