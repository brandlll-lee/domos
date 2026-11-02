import { type McpConfig, parseMcp } from "@domos/agent/mcp/config";
import { Button } from "@domos/ui/controls";
import { ConfirmDialog, Dialog } from "@domos/ui/dialog";
import { Checkbox } from "@domos/ui/field";
import { ArrowClockwiseIcon as ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { BookOpenIcon as BookOpen } from "@phosphor-icons/react/dist/csr/BookOpen";
import { CodeIcon as Code } from "@phosphor-icons/react/dist/csr/Code";
import { PlugsIcon as Plugs } from "@phosphor-icons/react/dist/csr/Plugs";
import { PlusIcon as Plus } from "@phosphor-icons/react/dist/csr/Plus";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { client } from "../../client.ts";
import { appsCopy } from "./copy.ts";
import "./style.css";

type Connection = Awaited<ReturnType<typeof client.mcp.list>>[number];
type Native = Awaited<ReturnType<typeof client.mcp.native>>;
type App = Awaited<ReturnType<typeof client.mcp.catalog>>[number];
type Draft = {
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
const draft = (): Draft => ({
  id: crypto.randomUUID(),
  revision: 0,
  name: "",
  computerId: "",
  enabled: true,
  paste: "",
  transport: "http",
  address: "",
  args: "[]",
  settings: "{}",
  editing: false,
});

export function AppsCenter({
  open,
  onOpenChange,
  bots,
  computers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: { id: number; name: string }[];
  computers: { id: string; name: string }[];
}) {
  const [view, updateView] = useState<"apps" | "connected" | "mcp">("apps");
  const viewport = useRef<HTMLDivElement>(null);
  const positions = useRef({ apps: 0, connected: 0, mcp: 0 });
  const setView = (next: typeof view) => {
    positions.current[view] = viewport.current?.scrollTop ?? 0;
    updateView(next);
  };
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = positions.current[view];
  }, [view]);
  const [items, setItems] = useState<Connection[]>([]),
    [catalog, setCatalog] = useState<App[]>([]);
  const [error, setError] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("");
  const [form, setForm] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Connection | null>(null),
    [native, setNative] = useState<Native | null>(null),
    [nativeBot, setNativeBot] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [records, apps] = await Promise.all([
        client.mcp.list(),
        client.mcp.catalog(),
      ]);
      setItems(records);
      setCatalog(apps);
      setError(null);
    } catch {
      setError(appsCopy.readError);
    }
  }, []);
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);
  const authorizationPending = items.some((item) => item.authorizationPending);
  useEffect(() => {
    if (!open || !authorizationPending) return;
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [open, authorizationPending, refresh]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败。请重试。");
    } finally {
      setBusy(false);
    }
  };
  const change = (next: Partial<Draft>) =>
    setForm((value) => value && { ...value, ...next });
  const setConfig = (name: string, config: McpConfig) =>
    setForm((value) => ({
      ...(value ?? draft()),
      name,
      paste: "",
      transport: config.transport,
      address: config.transport === "http" ? config.url : config.command,
      args: JSON.stringify(config.transport === "stdio" ? config.args : []),
      settings: JSON.stringify(
        config.transport === "http" ? config.headers : config.env,
        null,
        2,
      ),
    }));
  const start = (item?: Connection) => {
    setView("mcp");
    setForm(
      item
        ? {
            ...draft(),
            id: item.id,
            revision: item.revision,
            name: item.name,
            computerId: item.computerId,
            enabled: item.enabled,
            editing: true,
          }
        : draft(),
    );
  };
  const check = (item: Connection) =>
    void run(async () => {
      setChecking(item.id);
      try {
        await client.mcp.check({ id: item.id });
      } finally {
        setChecking(null);
      }
    });
  const grant = (
    item: Connection,
    botId: number,
    tools: string[] | null | undefined,
  ) =>
    void run(() =>
      client.mcp.grant({
        id: item.id,
        revision: item.revision,
        grants: [
          ...item.grants.filter((g) => g.botId !== botId),
          ...(tools === undefined ? [] : [{ botId, tools }]),
        ],
      }),
    );
  const categories = [...new Set(catalog.map((app) => app.category))];
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title="应用"
        viewportRef={viewport}
      >
        <div className="apps-center" aria-busy={busy}>
          <nav className="apps-center-nav" aria-label="连接中心">
            <Button
              variant={view === "apps" ? "secondary" : "ghost"}
              onClick={() => setView("apps")}
            >
              应用目录
            </Button>
            <span className="apps-center-spacer" />
            <Button
              variant={view === "connected" ? "secondary" : "ghost"}
              onClick={() => setView("connected")}
            >
              已连接
            </Button>
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="刷新连接"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <ArrowClockwise />
            </Button>
          </nav>
          <div className="apps-center-search">
            <input
              className="field-control"
              aria-label="搜索应用或连接"
              placeholder="搜索应用或连接"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              variant={view === "mcp" ? "secondary" : "ghost"}
              onClick={() => setView("mcp")}
            >
              <Plugs />
              MCP 服务器
            </Button>
          </div>
          {error && (
            <p role="alert" className="apps-error">
              {error}
            </p>
          )}
          {view === "apps" ? (
            <>
              <nav className="apps-center-nav" aria-label="应用分类">
                {["", ...categories].map((name) => (
                  <Button
                    key={name}
                    variant={category === name ? "secondary" : "ghost"}
                    onClick={() => setCategory(name)}
                  >
                    {name || "全部"}
                  </Button>
                ))}
              </nav>
              <div className="apps-catalog">
                {catalog
                  .filter(
                    (app) =>
                      (!category || app.category === category) &&
                      `${app.name} ${app.description}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )
                  .map((app) => (
                    <section className="apps-catalog-item" key={app.id}>
                      <div className="apps-logo" aria-hidden="true">
                        {app.icon === "BookOpen" ? <BookOpen /> : <Code />}
                      </div>
                      <div>
                        <strong>{app.name}</strong>
                        <p>{app.description}</p>
                        <p>{app.preparation}</p>
                        <a
                          href={app.documentation}
                          target="_blank"
                          rel="noreferrer"
                        >
                          官方说明
                        </a>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          start();
                          setConfig(app.id, app.config);
                        }}
                      >
                        连接
                      </Button>
                    </section>
                  ))}
              </div>
            </>
          ) : (
            <>
              {view === "mcp" && (
                <div className="apps-center-nav">
                  <h3>MCP 服务器</h3>
                  <span className="apps-center-spacer" />
                  <Button onClick={() => start()} disabled={busy}>
                    <Plus />
                    添加 MCP
                  </Button>
                </div>
              )}
              {form && view === "mcp" && (
                <form
                  className="apps-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      if (form.paste.trim())
                        throw new Error("请先预览粘贴的配置。");
                      const config = form.address.trim()
                        ? form.transport === "http"
                          ? {
                              transport: "http" as const,
                              url: form.address,
                              headers: JSON.parse(form.settings),
                            }
                          : {
                              transport: "stdio" as const,
                              command: form.address,
                              args: JSON.parse(form.args),
                              env: JSON.parse(form.settings),
                            }
                        : undefined;
                      const item = await client.mcp.save({
                        id: form.id,
                        revision: form.revision,
                        name: form.name,
                        computerId: form.computerId,
                        enabled: form.enabled,
                        config,
                      });
                      setForm(null);
                      if (item.enabled) await client.mcp.check({ id: item.id });
                    });
                  }}
                >
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
                  {form.paste && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        try {
                          const parsed = parseMcp(form.paste);
                          const entry = parsed[0];
                          if (parsed.length !== 1 || !entry)
                            throw new Error("请一次粘贴一个 MCP 配置。");
                          setConfig(entry.name, entry.config);
                          setError(null);
                        } catch (cause) {
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : "配置无效。",
                          );
                        }
                      }}
                    >
                      预览配置
                    </Button>
                  )}
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
                  {form.editing && (
                    <p className="apps-muted">{appsCopy.secretHint}</p>
                  )}
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
                    <summary>详细信息</summary>
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
                  <div className="apps-actions">
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => setForm(null)}
                    >
                      取消
                    </Button>
                    <Button type="submit" disabled={busy}>
                      保存并测试
                    </Button>
                  </div>
                </form>
              )}
              {items
                .filter((item) =>
                  item.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((item) => (
                  <section className="apps-item" key={item.id}>
                    <div className="apps-item-heading">
                      <div>
                        <strong>{item.name}</strong>
                        <p>
                          {!item.enabled
                            ? "已禁用"
                            : checking === item.id
                              ? "检查中…"
                              : appsCopy.status[
                                  item.status ?? "configured"
                                ]}{" "}
                          ·{" "}
                          {computers.find((pc) => pc.id === item.computerId)
                            ?.name ?? item.computerId}{" "}
                          · {item.transport}
                        </p>
                        {item.checkedAt && (
                          <p>
                            上次检查 {new Date(item.checkedAt).toLocaleString()}
                          </p>
                        )}
                        {item.error && <p role="status">{item.error}</p>}
                      </div>
                      <div className="apps-actions">
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => check(item)}
                        >
                          测试
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => start(item)}
                        >
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              client.mcp.save({
                                id: item.id,
                                revision: item.revision,
                                name: item.name,
                                computerId: item.computerId,
                                enabled: !item.enabled,
                              }),
                            )
                          }
                        >
                          {item.enabled ? "停用" : "启用"}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setRemoving(item)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                    {item.transport === "http" && (
                      <ConnectionLogin item={item} busy={busy} run={run} />
                    )}
                    <details>
                      <summary>
                        Bot 权限
                        {item.tools ? ` · ${item.tools.length} 个工具` : ""}
                      </summary>
                      {bots.map((bot) => {
                        const current = item.grants.find(
                          (g) => g.botId === bot.id,
                        );
                        return (
                          <div className="apps-grant" key={bot.id}>
                            <Checkbox
                              label={bot.name}
                              checked={!!current}
                              disabled={busy}
                              onCheckedChange={(checked) =>
                                grant(item, bot.id, checked ? null : undefined)
                              }
                            />
                            {current && item.tools && (
                              <details>
                                <summary>
                                  {current.tools === null
                                    ? "全部工具"
                                    : `已选 ${current.tools.length} 个工具`}
                                </summary>
                                <Checkbox
                                  label="全部工具"
                                  checked={current.tools === null}
                                  disabled={busy}
                                  onCheckedChange={(checked) =>
                                    grant(item, bot.id, checked ? null : [])
                                  }
                                />
                                {item.tools.map((tool) => (
                                  <Checkbox
                                    key={tool.name}
                                    label={tool.title ?? tool.name}
                                    disabled={busy}
                                    checked={
                                      current.tools === null ||
                                      current.tools.includes(tool.name)
                                    }
                                    onCheckedChange={(checked) => {
                                      const selected =
                                        current.tools ??
                                        (item.tools ?? []).map((t) => t.name);
                                      grant(
                                        item,
                                        bot.id,
                                        checked
                                          ? [...selected, tool.name]
                                          : selected.filter(
                                              (name) => name !== tool.name,
                                            ),
                                      );
                                    }}
                                  />
                                ))}
                              </details>
                            )}
                          </div>
                        );
                      })}
                    </details>
                    {item.capabilities && (
                      <p className="apps-muted">
                        {[
                          item.capabilities.tools && "工具",
                          item.capabilities.resources && "资源",
                          item.capabilities.prompts && "提示词",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </section>
                ))}
              {!items.length && !form && (
                <p className="apps-muted">尚未添加连接。</p>
              )}
              {view === "mcp" && (
                <section className="apps-native">
                  <h3>Harness 原生连接</h3>
                  <p className="apps-muted">{appsCopy.nativeHint}</p>
                  <label>
                    选择 Bot
                    <select
                      className="field-control"
                      value={nativeBot}
                      disabled={busy}
                      onChange={(e) => {
                        const id = e.target.value;
                        setNativeBot(id);
                        setNative(null);
                        if (id)
                          void run(async () =>
                            setNative(
                              await client.mcp.native({ botId: Number(id) }),
                            ),
                          );
                      }}
                    >
                      <option value="">选择 Bot</option>
                      {bots.map((bot) => (
                        <option key={bot.id} value={bot.id}>
                          {bot.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {native && (
                    <>
                      <p>
                        {native.provider} ·{" "}
                        {computers.find((pc) => pc.id === native.computerId)
                          ?.name ?? native.computerId}{" "}
                        · 只读
                      </p>
                      {native.inheritance === "selectable" && (
                        <Checkbox
                          label="在下一轮沿用原生连接"
                          checked={native.inherited}
                          disabled={busy}
                          onCheckedChange={(enabled) =>
                            void run(async () =>
                              setNative(
                                await client.mcp.native({
                                  botId: Number(nativeBot),
                                  enabled,
                                }),
                              ),
                            )
                          }
                        />
                      )}
                      {native.items.map((item) => (
                        <div className="apps-native-row" key={item.name}>
                          <strong>{item.name}</strong>
                          <span>
                            {item.enabled && native.inherited
                              ? "允许沿用原生配置"
                              : "已停用或不沿用"}{" "}
                            · {item.status}
                          </span>
                          <small>{item.source}</small>
                        </div>
                      ))}
                      {!native.items.length && (
                        <p className="apps-muted">未发现原生 MCP。</p>
                      )}
                    </>
                  )}
                </section>
              )}
              {view === "mcp" && (
                <p className="apps-muted">{appsCopy.capabilitiesHint}</p>
              )}
            </>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="删除连接"
        description="使用此连接的 Bot 将失去访问权限。"
        onConfirm={() => {
          if (removing)
            void run(() =>
              client.mcp.remove({
                id: removing.id,
                revision: removing.revision,
              }),
            );
          setRemoving(null);
        }}
      />
    </>
  );
}

function ConnectionLogin({
  item,
  busy,
  run,
}: {
  item: Connection;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [oauthClient, setOauthClient] = useState("");
  const [oauthSecret, setOauthSecret] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  return (
    <details>
      <summary>登录与凭据</summary>
      <div className="apps-actions">
        <Button
          variant="secondary"
          disabled={busy || !item.enabled}
          onClick={() =>
            void run(async () => {
              const login = await client.mcp.login({
                id: item.id,
                client: oauthClient
                  ? {
                      client_id: oauthClient,
                      client_secret: oauthSecret || undefined,
                    }
                  : undefined,
              });
              setOauthSecret("");
              if (login.url) {
                setAuthorizationUrl(login.url);
                window.open(login.url, "_blank", "noopener,noreferrer");
              }
            })
          }
        >
          浏览器登录
        </Button>
        {item.authorizationPending && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await client.mcp.logout({
                  id: item.id,
                  cancel: true,
                });
                setAuthorizationUrl(null);
              })
            }
          >
            取消登录
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void run(() => client.mcp.logout({ id: item.id }))}
        >
          退出登录
        </Button>
      </div>
      {item.authorizationPending && authorizationUrl && (
        <a href={authorizationUrl} target="_blank" rel="noreferrer">
          继续浏览器授权
        </a>
      )}
      <details>
        <summary>自定义 OAuth 客户端</summary>
        <div className="apps-form-columns">
          <label>
            Client ID
            <input
              className="field-control"
              value={oauthClient}
              onChange={(e) => setOauthClient(e.target.value)}
            />
          </label>
          <label>
            Client secret
            <input
              type="password"
              className="field-control"
              autoComplete="new-password"
              value={oauthSecret}
              onChange={(e) => setOauthSecret(e.target.value)}
            />
          </label>
        </div>
      </details>
    </details>
  );
}
