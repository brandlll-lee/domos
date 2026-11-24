import { type McpConfig, parseMcp } from "@domos/agent/mcp/config";
import { Button } from "@domos/ui/controls";
import { ConfirmDialog, Dialog } from "@domos/ui/dialog";
import { Disclosure } from "@domos/ui/disclosure";
import { Checkbox, SearchField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { ActionMenu } from "@domos/ui/menu";
import { PanelRow } from "@domos/ui/panel";
import { ChoicePicker } from "@domos/ui/picker";
import { Tabs } from "@domos/ui/tabs";
import { ArrowClockwiseIcon as ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { PlusIcon as Plus } from "@phosphor-icons/react/dist/csr/Plus";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { client } from "../../client.ts";
import { useReadState } from "../read-state.ts";
import {
  ConnectionHint,
  ConnectionIcon,
  ConnectionStatus,
  ConnectionTools,
  NativeConnectionDetails,
  NativeConnections,
} from "./connection-details.tsx";
import { ConnectionEditor, type Draft } from "./connection-editor.tsx";
import {
  appCatalog,
  managedConnections,
  nativeConnections,
} from "./connection-state.ts";
import { appsCopy, nativeMcpNotice } from "./copy.ts";
import "./style.css";

type Connection = Awaited<ReturnType<typeof client.mcp.list>>[number];
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
  currentBotId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: { id: number; name: string }[];
  computers: { id: string; name: string }[];
  currentBotId?: number;
}) {
  const [view, updateView] = useState<"apps" | "connected">("connected");
  const viewport = useRef<HTMLDivElement>(null);
  const positions = useRef({ apps: 0, connected: 0 });
  const setView = (next: typeof view) => {
    positions.current[view] = viewport.current?.scrollTop ?? 0;
    updateView(next);
  };
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = positions.current[view];
  }, [view]);
  const managed = useReadState(managedConnections, open);
  const apps = useReadState(appCatalog, open);
  const items = managed.data ?? [];
  const catalog = apps.data ?? [];
  const loaded =
    view === "apps" ? apps.data !== undefined : managed.data !== undefined;
  const reading = managed.loading || apps.loading;
  const [selectedId, setSelectedId] = useState<string>();
  const [appInfo, setAppInfo] = useState<App>();
  const [queries, setQueries] = useState({ apps: "", connected: "" });
  const query = queries[view];
  const setQuery = (query: string) =>
    setQueries((current) => ({ ...current, [view]: query }));
  const [error, setError] = useState<string | null>(null),
    [category, setCategory] = useState("");
  const [form, setForm] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Connection | null>(null);
  const [nativeBot, setNativeBot] = useState(
    currentBotId ? String(currentBotId) : "",
  );
  const [selectedNative, setSelectedNative] = useState<string>();
  const [step, setStep] = useState<"import" | "confirm">("import");
  const source = useRef<string>("add-mcp");
  const restoreFocus = useRef(false);
  const location = form
    ? `editor:${form.id}`
    : (selectedId ?? (selectedNative ? `native:${selectedNative}` : view));
  useLayoutEffect(() => {
    if (location.startsWith("editor:")) {
      viewport.current
        ?.querySelector<HTMLElement>(step === "import" ? "textarea" : "input")
        ?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      if (viewport.current)
        viewport.current.scrollTop = positions.current[view];
      viewport.current
        ?.closest(".dialog-popup")
        ?.querySelector<HTMLElement>(
          `[data-connection-action="${CSS.escape(source.current)}"]`,
        )
        ?.focus();
    }
  }, [location, step, view]);
  const nativeStore = nativeConnections(Number(nativeBot));
  const nativeState = useReadState(
    nativeStore,
    open && view === "connected" && !form && !selectedId && !!nativeBot,
  );
  const native = nativeState.data;
  const nativeReading = nativeState.loading;
  const nativeError = nativeState.error ? appsCopy.nativeReadError : null;
  const refreshNative = (id: string) => {
    if (id)
      void nativeConnections(Number(id))
        .load(true)
        .catch(() => {});
  };
  const refresh = useCallback(async () => {
    await Promise.allSettled([
      managedConnections.load(true),
      appCatalog.load(true),
    ]);
  }, []);
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
      managedConnections.invalidate();
      await managedConnections.load().catch(() => {});
    } catch (cause) {
      managedConnections.invalidate();
      await managedConnections.load().catch(() => {});
      setError(cause instanceof Error ? cause.message : "操作失败。请重试。");
    } finally {
      setBusy(false);
    }
  };
  const change = (next: Partial<Draft>) =>
    setForm((value) => value && { ...value, ...next });
  const setConfig = (name: string, config: McpConfig) => {
    setStep("confirm");
    setForm((value) => ({
      ...(value ?? draft()),
      name,
      transport: config.transport,
      address: config.transport === "http" ? config.url : config.command,
      args: JSON.stringify(config.transport === "stdio" ? config.args : []),
      settings: JSON.stringify(
        config.transport === "http" ? config.headers : config.env,
        null,
        2,
      ),
    }));
  };
  const start = (item?: Connection) => {
    positions.current[view] = viewport.current?.scrollTop ?? 0;
    source.current =
      item?.id ??
      (document.activeElement as HTMLElement)?.dataset.connectionAction ??
      "add-mcp";
    setStep(item ? "confirm" : "import");
    setError(null);
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
            transport: item.transport,
            editing: true,
          }
        : draft(),
    );
  };
  const backToList = () => {
    restoreFocus.current = true;
    setForm(null);
    setSelectedId(undefined);
    setSelectedNative(undefined);
    setError(null);
  };
  const back = () => {
    setError(null);
    if (form && step === "confirm" && !form.editing && !appInfo) {
      setStep("import");
    } else if (form?.editing) {
      restoreFocus.current = true;
      setForm(null);
    } else backToList();
  };
  const preview = () => {
    if (!form) return;
    try {
      const parsed = parseMcp(form.paste);
      const entry = parsed[0];
      if (parsed.length !== 1 || !entry)
        throw new Error("请一次粘贴一个 MCP 配置。");
      setConfig(entry.name, entry.config);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "配置无效。");
    }
  };
  const testConnection = async (id: string) => {
    setChecking(id);
    try {
      await client.mcp.check({ id });
    } finally {
      setChecking(null);
    }
  };
  const check = (item: Connection) => void run(() => testConnection(item.id));
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
              : "添加 MCP"
            : selectedId || selectedNative
              ? "连接详情"
              : "应用连接"
        }
        className="apps-dialog"
        viewportRef={viewport}
        onBack={form || selectedId || selectedNative ? back : undefined}
        backDisabled={busy}
        headerActions={
          !form && (
            <>
              {!selectedId && !selectedNative && view === "connected" && (
                <div className="connection-scope">
                  <ChoicePicker
                    label="选择机器人"
                    placeholder="选择机器人"
                    size="small"
                    value={nativeBot}
                    disabled={busy}
                    items={bots.map((bot) => ({
                      value: String(bot.id),
                      label: bot.name,
                    }))}
                    onValueChange={(id) => setNativeBot(id)}
                  />
                  <ConnectionHint label="连接查看范围">
                    机器人选择切换原生目录。Domos 管理的连接属于当前电脑。
                  </ConnectionHint>
                </div>
              )}
              <Button
                variant="ghost"
                size="icon-small"
                aria-label="刷新连接"
                disabled={reading || busy || nativeReading}
                onClick={() => {
                  void refresh();
                  if (view === "connected") refreshNative(nativeBot);
                }}
              >
                <ArrowClockwise />
              </Button>
            </>
          )
        }
        subheader={
          !form &&
          !selectedId &&
          !selectedNative && (
            <div className="apps-navigation">
              <div className="section-heading">
                <Tabs.Root
                  value={view}
                  onValueChange={(value) => setView(value as typeof view)}
                >
                  <Tabs.List className="navigation-tabs" aria-label="连接页面">
                    <Tabs.Tab className="navigation-tab" value="connected">
                      我的连接
                    </Tabs.Tab>
                    <Tabs.Tab className="navigation-tab" value="apps">
                      发现应用
                    </Tabs.Tab>
                  </Tabs.List>
                </Tabs.Root>
                <Button
                  variant="secondary"
                  data-connection-action="add-mcp"
                  onClick={() => start()}
                  disabled={busy}
                >
                  <Plus />
                  添加 MCP
                </Button>
              </div>
              <SearchField
                variant="quiet"
                aria-label="搜索当前页面"
                placeholder={view === "apps" ? "搜索应用" : "搜索连接"}
                value={query}
                onValueChange={setQuery}
              />
              {view === "apps" && (
                <Tabs.Root value={category} onValueChange={setCategory}>
                  <Tabs.List className="navigation-tabs" aria-label="应用分类">
                    {["", ...categories].map((name) => (
                      <Tabs.Tab
                        className="navigation-tab"
                        key={name}
                        value={name}
                      >
                        {name || "全部"}
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                </Tabs.Root>
              )}
            </div>
          )
        }
        footer={
          form && (
            <div className="dialog-actions">
              <Button variant="ghost" disabled={busy} onClick={backToList}>
                取消
              </Button>
              {step === "import" ? (
                <Button
                  key="import"
                  type="button"
                  disabled={!form.paste.trim()}
                  onClick={preview}
                >
                  继续
                </Button>
              ) : (
                <Button
                  key="confirm"
                  type="submit"
                  form="connection-editor"
                  pending={busy}
                >
                  保存并测试
                </Button>
              )}
            </div>
          )
        }
      >
        <div
          className={`apps-center ${form ? "form-content" : ""}`}
          aria-busy={busy}
        >
          {Boolean(managed.error || apps.error) && (
            <p role="alert">{appsCopy.readError}</p>
          )}
          {!loaded && reading && <Loading label="正在读取连接" />}
          {!loaded && Boolean(error || managed.error || apps.error) && (
            <Button variant="secondary" onClick={() => void refresh()}>
              重新读取
            </Button>
          )}
          {loaded &&
            !form &&
            !selectedId &&
            !selectedNative &&
            query &&
            (view === "apps" || !nativeBot || native?.status === "complete") &&
            !(view === "apps"
              ? catalog.some(
                  (app) =>
                    (!category || app.category === category) &&
                    `${app.name} ${app.description}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                )
              : items.some((item) =>
                  item.name.toLowerCase().includes(query.toLowerCase()),
                ) ||
                native?.items.some((item) =>
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
              {loaded && !catalog.length && (
                <p className="apps-muted">暂无可用应用。</p>
              )}
              <div className="apps-catalog">
                {categories
                  .filter(
                    (name) =>
                      (!category || name === category) &&
                      catalog.some(
                        (app) =>
                          app.category === name &&
                          `${app.name} ${app.description}`
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                      ),
                  )
                  .map((name) => (
                    <section className="apps-category" key={name}>
                      {!category && <h3>{name}</h3>}
                      <div className="apps-catalog-rows">
                        {catalog
                          .filter(
                            (app) =>
                              app.category === name &&
                              `${app.name} ${app.description}`
                                .toLowerCase()
                                .includes(query.toLowerCase()),
                          )
                          .map((app) => (
                            <section className="apps-catalog-item" key={app.id}>
                              <div className="apps-logo" aria-hidden="true">
                                <ConnectionIcon
                                  name={app.name}
                                  icon={app.icon}
                                />
                              </div>
                              <div>
                                <strong>{app.name}</strong>
                                <p>{app.description}</p>
                              </div>
                              <Button
                                variant="secondary"
                                data-connection-action={app.id}
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
                    </section>
                  ))}
              </div>
            </>
          ) : (
            <>
              {form && (
                <ConnectionEditor
                  form={form}
                  appInfo={appInfo}
                  computers={computers}
                  step={step}
                  onManual={() => {
                    setStep("confirm");
                    setError(null);
                  }}
                  busy={busy}
                  change={change}
                  onSave={() => {
                    void run(async () => {
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
                      managedConnections.receive([
                        ...(managedConnections.snapshot().data ?? []).filter(
                          (saved) => saved.id !== item.id,
                        ),
                        item,
                      ]);
                      source.current = item.id;
                      setSelectedId(item.id);
                      setQueries((current) => ({ ...current, connected: "" }));
                      setView("connected");
                      setForm(null);
                      if (item.enabled) await testConnection(item.id);
                    });
                  }}
                />
              )}
              {!form &&
                !selectedNative &&
                (view === "connected" || selectedId) &&
                items
                  .filter((item) =>
                    selectedId
                      ? item.id === selectedId
                      : item.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((item) =>
                    selectedId ? (
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
                                上次检查{" "}
                                {new Date(item.checkedAt).toLocaleString()}
                              </p>
                            )}
                            {item.error && <p role="status">{item.error}</p>}
                          </div>
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
                        </div>

                        {!item.grants.length && (
                          <p className="apps-muted">尚未分配机器人</p>
                        )}
                        {item.status === "failed" && (
                          <Button
                            variant="secondary"
                            onClick={() => check(item)}
                            disabled={busy}
                          >
                            重试测试
                          </Button>
                        )}
                        {item.transport === "http" && (
                          <ConnectionLogin item={item} busy={busy} run={run} />
                        )}
                        <Disclosure
                          label={
                            <>
                              机器人权限
                              {item.tools
                                ? ` · ${item.tools.length} 个工具`
                                : ""}
                            </>
                          }
                        >
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
                                  <Disclosure
                                    label={
                                      current.tools === null
                                        ? "全部工具"
                                        : `已选 ${current.tools.length} 个工具`
                                    }
                                  >
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
                                  </Disclosure>
                                )}
                              </div>
                            );
                          })}
                        </Disclosure>
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
                        <ConnectionTools tools={item.tools} />
                      </section>
                    ) : (
                      <PanelRow
                        key={item.id}
                        variant="navigation"
                        title={item.name}
                        aria-label={`查看 ${item.name}`}
                        data-connection-action={item.id}
                        icon={
                          <ConnectionIcon
                            name={item.name}
                            icon={
                              catalog.find((app) => app.name === item.name)
                                ?.icon
                            }
                          />
                        }
                        description={`${computers.find((pc) => pc.id === item.computerId)?.name ?? item.computerId} · 已授权 ${item.grants.length} 个机器人`}
                        value={
                          <>
                            {item.tools && (
                              <span>{item.tools.length} 个工具</span>
                            )}
                            <ConnectionStatus
                              status={
                                item.enabled
                                  ? (item.status ?? "configured")
                                  : "disabled"
                              }
                              label={
                                item.enabled
                                  ? appsCopy.status[item.status ?? "configured"]
                                  : "已禁用"
                              }
                            />
                          </>
                        }
                        onClick={() => {
                          positions.current[view] =
                            viewport.current?.scrollTop ?? 0;
                          source.current = item.id;
                          setSelectedId(item.id);
                        }}
                      />
                    ),
                  )}
              {view === "connected" && !form && !selectedId && (
                <>
                  {nativeReading && !native && (
                    <Loading label="正在读取原生连接" inline />
                  )}
                  {nativeError && <p role="alert">{nativeError}</p>}
                  {native && nativeMcpNotice(native) && (
                    <p role="status">{nativeMcpNotice(native)}</p>
                  )}
                  {native &&
                    (selectedNative ? (
                      native.items
                        .filter((item) => item.name === selectedNative)
                        .map((item) => (
                          <NativeConnectionDetails
                            key={item.name}
                            item={item}
                            catalog={native}
                          />
                        ))
                    ) : (
                      <>
                        <NativeConnections
                          catalog={native}
                          query={query}
                          onSelect={(name) => {
                            positions.current[view] =
                              viewport.current?.scrollTop ?? 0;
                            source.current = `native:${name}`;
                            setSelectedNative(name);
                          }}
                        />
                        {native.inheritance === "selectable" && (
                          <Checkbox
                            label="在下一轮沿用原生连接"
                            checked={native.inherited}
                            disabled={busy}
                            onCheckedChange={(enabled) =>
                              void run(async () => {
                                nativeStore.receive(
                                  await client.mcp.native({
                                    botId: Number(nativeBot),
                                    enabled,
                                  }),
                                );
                              })
                            }
                          />
                        )}
                      </>
                    ))}
                  {loaded &&
                    !items.length &&
                    native?.status === "complete" &&
                    !native.items.length &&
                    !query && <p className="apps-muted">尚未添加连接。</p>}
                </>
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
    <Disclosure
      open={loginOpen}
      onToggle={(event) => setLoginOpen(event.currentTarget.open)}
      label="登录与凭据"
    >
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
      <Disclosure label="自定义 OAuth 客户端">
        <div className="form-fields">
          <label className="field">
            <span className="field-label">客户端编号</span>
            <input
              className="field-control"
              value={oauthClient}
              onChange={(e) => setOauthClient(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">客户端密钥</span>
            <input
              type="password"
              className="field-control"
              autoComplete="new-password"
              value={oauthSecret}
              onChange={(e) => setOauthSecret(e.target.value)}
            />
          </label>
        </div>
      </Disclosure>
    </Disclosure>
  );
}
