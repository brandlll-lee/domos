import { Button } from "@domos/ui/controls";
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
  busy,
  manual,
  setManual,
  change,
  onSave,
  onPreview,
  onCancel,
}: {
  form: Draft;
  appInfo?: Awaited<ReturnType<typeof client.mcp.catalog>>[number];
  computers: { id: string; name: string }[];
  busy: boolean;
  manual: boolean;
  setManual: (value: boolean) => void;
  change: (value: Partial<Draft>) => void;
  onSave: () => void;
  onPreview: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="apps-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      {appInfo && (
        <p>
          {appInfo.preparation}{" "}
          <a href={appInfo.documentation} target="_blank" rel="noreferrer">
            官方说明
          </a>
        </p>
      )}
      {!appInfo && !form.editing && (
        <label>
          粘贴 MCP 地址或配置
          <textarea
            className="field-control"
            rows={3}
            value={form.paste}
            onChange={(e) => change({ paste: e.target.value })}
            placeholder="URL、mcpServers JSON 或支持的 MCP 添加命令"
          />
        </label>
      )}
      {form.paste && (
        <Button type="button" variant="secondary" onClick={onPreview}>
          预览配置
        </Button>
      )}
      {!appInfo && !form.editing && !form.address && (
        <Button type="button" variant="ghost" onClick={() => setManual(true)}>
          手动配置
        </Button>
      )}
      {(manual || appInfo || form.editing || form.address) && (
        <>
          <div className="apps-form-columns">
            <label>
              名称
              <input
                className="field-control"
                required
                value={form.name}
                onChange={(e) => change({ name: e.target.value })}
              />
            </label>
            <label>
              运行／访问电脑
              <select
                className="field-control"
                required
                value={form.computerId}
                onChange={(e) => change({ computerId: e.target.value })}
              >
                <option value="">选择电脑</option>
                {computers.map((pc) => (
                  <option key={pc.id} value={pc.id}>
                    {pc.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {form.editing && <p className="apps-muted">{appsCopy.secretHint}</p>}
          <label>
            传输方式
            <select
              className="field-control"
              value={form.transport}
              onChange={(e) =>
                change({
                  transport: e.target.value as Draft["transport"],
                })
              }
            >
              <option value="http">HTTP / SSE</option>
              <option value="stdio">本地命令（stdio）</option>
            </select>
          </label>
          <label>
            {form.transport === "http" ? "MCP 地址" : "启动程序"}
            <input
              className="field-control"
              required={!form.editing}
              type={form.transport === "http" ? "url" : "text"}
              value={form.address}
              onChange={(e) => change({ address: e.target.value })}
            />
          </label>
          <details>
            <summary>高级设置</summary>
            {form.transport === "stdio" && (
              <label>
                参数（JSON 数组）
                <textarea
                  className="field-control"
                  value={form.args}
                  onChange={(e) => change({ args: e.target.value })}
                />
              </label>
            )}
            <label>
              {form.transport === "http"
                ? "请求头（JSON，可填写 Key / Token）"
                : "环境变量（JSON）"}
              <textarea
                className="field-control"
                autoComplete="off"
                spellCheck={false}
                value={form.settings}
                onChange={(e) => change({ settings: e.target.value })}
              />
            </label>
          </details>
        </>
      )}
      <div className="apps-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>
          取消
        </Button>
        <Button
          type="submit"
          disabled={
            busy || !(manual || appInfo || form.editing || form.address)
          }
        >
          保存并测试
        </Button>
      </div>
    </form>
  );
}
