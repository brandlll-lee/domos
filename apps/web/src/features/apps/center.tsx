import { type McpConfig, parseMcp } from "@domos/agent/mcp/config";
import { Button } from "@domos/ui/controls";
import { ConfirmDialog, Dialog } from "@domos/ui/dialog";
import { Checkbox } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { Tabs } from "@domos/ui/tabs";
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
import { ConnectionEditor, type Draft } from "./connection-editor.tsx";
import { appsCopy } from "./copy.ts";
import "./style.css";

type Connection = Awaited<ReturnType<typeof client.mcp.list>>[number];
type Native = Awaited<ReturnType<typeof client.mcp.native>>;
type App = Awaited<ReturnType<typeof client.mcp.catalog>>[number];

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
  const [loaded, setLoaded] = useState(false);
  const [reading, setReading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [appInfo, setAppInfo] = useState<App>();
  const [queries, setQueries] = useState({ apps: "", connected: "", mcp: "" });
  const query = queries[view];
  const setQuery = (query: string) =>
    setQueries((current) => ({ ...current, [view]: query }));
  const [error, setError] = useState<string | null>(null),
    [category, setCategory] = useState("");
  const [form, setForm] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Connection | null>(null),
    [native, setNative] = useState<Native | null>(null),
    [nativeBot, setNativeBot] = useState("");
  const [manual, setManual] = useState(false);
  const [nativeReading, setNativeReading] = useState(false);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const nativeSelection = useRef("");
  const refreshNative = async (id: string) => {
    if (!id) return;
    setNativeReading(true);
    setNativeError(null);
    try {
      const result = await client.mcp.native({ botId: Number(id) });
      if (nativeSelection.current === id) setNative(result);
    } catch {
      if (nativeSelection.current === id)
        setNativeError(appsCopy.nativeReadError);
    } finally {
      if (nativeSelection.current === id) setNativeReading(false);
    }
  };
  const refresh = useCallback(async () => {
    setReading(true);
    try {
      const [records, apps] = await Promise.all([
        client.mcp.list(),
        client.mcp.catalog(),
      ]);
      setItems(records);
      setCatalog(apps);
      setLoaded(true);
      setError(null);
    } catch {
      setError(appsCopy.readError);
    } finally {
      setReading(false);
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
      await refresh();
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
    positions.current[view] = viewport.current?.scrollTop ?? 0;
    setManual(!!item);
    setAppInfo(undefined);
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
        title={
          form
            ? form.editing
              ? "编辑连接"
              : "添加连接"
            : selectedId
              ? "连接详情"
              : "连接中心"
        }
        className="apps-dialog"
        viewportRef={viewport}
        headerActions={
          !form && (
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="刷新连接"
              disabled={reading || busy || nativeReading}
              onClick={() => {
                void refresh();
                if (view === "mcp") void refreshNative(nativeBot);
              }}
            >
              <ArrowClockwise />
            </Button>
          )
        }
      >
        <div className="apps-center" aria-busy={busy}>
          {form || selectedId ? (
            <Button
              variant="ghost"
              onClick={() => {
                setForm(null);
                setSelectedId(undefined);
                requestAnimationFrame(() => {
                  if (viewport.current)
                    viewport.current.scrollTop = positions.current[view];
                });
              }}
            >
              返回列表
            </Button>
          ) : (
            <>
              <div className="apps-center-nav">
                <Tabs.Root
                  value={view}
                  onValueChange={(value) => setView(value as typeof view)}
                >
                  <Tabs.List aria-label="连接中心" className="apps-tabs">
                    {(
                      [
                        ["apps", "应用"],
                        ["mcp", "MCP"],
                        ["connected", `已添加 ${items.length}`],
                      ] as const
                    ).map(([value, label]) => (
                      <Tabs.Tab
                        key={value}
                        value={value}
                        className="button"
                        data-variant={view === value ? "secondary" : "ghost"}
                      >
                        {label}
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                </Tabs.Root>
              </div>
              <input
                className="field-control"
                aria-label="搜索当前页面"
                placeholder="搜索当前页面…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </>
          )}
          {!loaded && reading && <p role="status">正在读取连接…</p>}
          {!loaded && error && (
            <Button variant="secondary" onClick={() => void refresh()}>
              重新读取
            </Button>
          )}
          {loaded &&
            !form &&
            !selectedId &&
            query &&
            !(view === "apps"
              ? catalog.some(
                  (app) =>
                    (!category || app.category === category) &&
                    `${app.name} ${app.description}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                )
              : view === "mcp"
                ? native?.items.some((item) =>
                    item.name.toLowerCase().includes(query.toLowerCase()),
                  )
                : items.some((item) =>
                    item.name.toLowerCase().includes(query.toLowerCase()),
                  )) && (
              <p role="status">
                没有找到匹配项。
                <Button
                  variant="ghost"
                  onClick={() => {
                    setQuery("");
                    setCategory("");
                  }}
                >
                  清除筛选
                </Button>
              </p>
            )}
          {error && (
            <p role="alert" className="apps-error">
              {error}
            </p>
          )}
          {view === "apps" && !form && !selectedId ? (
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
              {loaded && !catalog.length && (
                <p className="apps-muted">暂无可用应用。</p>
              )}
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
                        {(() => {
                          const Icon =
                            (
                              { BookOpen, Code } as Record<
                                string,
                                typeof BookOpen
                              >
                            )[app.icon] ?? Plugs;
                          return <Icon />;
                        })()}
                      </div>
                      <div>
                        <strong>{app.name}</strong>
                        <p>{app.description}</p>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          start();
                          setAppInfo(app);
                          setConfig(app.name, app.config);
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
              {view === "mcp" && !form && !selectedId && (
                <div className="apps-center-nav">
                  <Button
                    variant="secondary"
                    onClick={() => setView("connected")}
                  >
                    查看已添加连接
                  </Button>
                  <span className="apps-center-spacer" />
                  <Button onClick={() => start()} disabled={busy}>
                    <Plus />
                    添加 MCP
                  </Button>
                </div>
              )}
              {form && (
                <ConnectionEditor
                  form={form}
                  appInfo={appInfo}
                  computers={computers}
                  busy={busy}
                  manual={manual}
                  setManual={setManual}
                  change={change}
                  onCancel={() => setForm(null)}
                  onSave={() => {
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
                      setSelectedId(item.id);
                      setView("connected");
                      setForm(null);
                      if (item.enabled) await client.mcp.check({ id: item.id });
                    });
                  }}
                  onPreview={() => {
                    try {
                      const parsed = parseMcp(form.paste);
                      const entry = parsed[0];
                      if (parsed.length !== 1 || !entry)
                        throw new Error("请一次粘贴一个 MCP 配置。");
                      setConfig(entry.name, entry.config);
                      setError(null);
                    } catch (cause) {
                      setError(
                        cause instanceof Error ? cause.message : "配置无效。",
                      );
                    }
                  }}
                />
              )}
              {!form &&
                (view === "connected" || selectedId) &&
                items
                  .filter((item) =>
                    selectedId
                      ? item.id === selectedId
                      : item.name.toLowerCase().includes(query.toLowerCase()),
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
                            ·{" "}
                            {selectedId
                              ? item.transport
                              : `已授权 ${item.grants.length} 个机器人`}
                          </p>
                          {selectedId && item.checkedAt && (
                            <p>
                              上次检查{" "}
                              {new Date(item.checkedAt).toLocaleString()}
                            </p>
                          )}
                          {selectedId && item.error && (
                            <p role="status">{item.error}</p>
                          )}
                        </div>
                        {selectedId ? (
                          <ActionMenu
                            label={`${item.name}的操作`}
                            disabled={busy}
                            items={[
                              { label: "测试", onSelect: () => check(item) },
                              { label: "编辑", onSelect: () => start(item) },
                              {
                                label: item.enabled ? "停用" : "启用",
                                onSelect: () =>
                                  void run(() =>
                                    client.mcp.save({
                                      id: item.id,
                                      revision: item.revision,
                                      name: item.name,
                                      computerId: item.computerId,
                                      enabled: !item.enabled,
                                    }),
                                  ),
                              },
                              {
                                label: "删除",
                                tone: "danger",
                                onSelect: () => setRemoving(item),
                              },
                            ]}
                          />
                        ) : (
                          <Button
                            variant="ghost"
                            aria-label={`查看 ${item.name}`}
                            onClick={() => {
                              positions.current[view] =
                                viewport.current?.scrollTop ?? 0;
                              setSelectedId(item.id);
                            }}
                          >
                            查看 ›
                          </Button>
                        )}
                      </div>

                      {selectedId && !item.grants.length && (
                        <p className="apps-muted">尚未分配机器人</p>
                      )}
                      {selectedId && item.status === "failed" && (
                        <Button
                          variant="secondary"
                          onClick={() => check(item)}
                          disabled={busy}
                        >
                          重试测试
                        </Button>
                      )}
                      {selectedId && item.transport === "http" && (
                        <ConnectionLogin item={item} busy={busy} run={run} />
                      )}
                      {selectedId && (
                        <details>
                          <summary>
                            机器人权限
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
                                    grant(
                                      item,
                                      bot.id,
                                      checked ? null : undefined,
                                    )
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
                                            (item.tools ?? []).map(
                                              (t) => t.name,
                                            );
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
                      )}
                      {selectedId && item.capabilities && (
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
              {loaded && view === "connected" && !items.length && !form && (
                <p className="apps-muted">尚未添加连接。</p>
              )}
              {view === "mcp" && !form && !selectedId && (
                <section className="apps-native">
                  <h3>引擎原生连接</h3>
                  {nativeReading && <p role="status">正在读取原生连接…</p>}
                  {nativeError && <p role="alert">{nativeError}</p>}
                  <p className="apps-muted">{appsCopy.nativeHint}</p>
                  <label>
                    选择机器人
                    <select
                      className="field-control"
                      value={nativeBot}
                      disabled={busy}
                      onChange={(e) => {
                        const id = e.target.value;
                        nativeSelection.current = id;
                        setNativeBot(id);
                        setNative(null);
                        setNativeError(null);
                        setNativeReading(false);
                        void refreshNative(id);
                      }}
                    >
                      <option value="">选择机器人</option>
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
                      {native.items
                        .filter((item) =>
                          item.name.toLowerCase().includes(query.toLowerCase()),
                        )
                        .map((item) => (
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
              {view === "mcp" && !form && !selectedId && (
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
        description="使用此连接的机器人将失去访问权限。"
        onConfirm={() => {
          if (removing)
            void run(() =>
              client.mcp.remove({
                id: removing.id,
                revision: removing.revision,
              }),
            );
          setSelectedId(undefined);
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
  const [loginOpen, setLoginOpen] = useState(
    item.status === "authorization_required" || item.authorizationPending,
  );
  useEffect(() => {
    if (item.status === "authorization_required" || item.authorizationPending)
      setLoginOpen(true);
  }, [item.status, item.authorizationPending]);
  const [oauthClient, setOauthClient] = useState("");
  const [oauthSecret, setOauthSecret] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  return (
    <details
      open={loginOpen}
      onToggle={(event) => setLoginOpen(event.currentTarget.open)}
    >
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
            客户端编号
            <input
              className="field-control"
              value={oauthClient}
              onChange={(e) => setOauthClient(e.target.value)}
            />
          </label>
          <label>
            客户端密钥
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
