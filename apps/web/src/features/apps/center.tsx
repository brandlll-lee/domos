import type { Bot } from "@domos/agent/bots";
import { type McpConfig, parseMcp } from "@domos/agent/mcp/config";
import { characterIdentity } from "@domos/ui/characters";
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
  CatalogDetail,
  ConnectionDetail,
  type ConnectionSummary,
} from "./connection-detail.tsx";
import { nativeSummaries } from "./connection-details.tsx";
import type { Draft } from "./connection-editor.tsx";
import { ConnectionLogin } from "./connection-login.tsx";
import { ConnectionPage } from "./connection-page.tsx";
import {
  ConnectionSetup,
  NativeConnectionSettings,
} from "./connection-setup.tsx";
import {
  appCatalog,
  managedConnections,
  nativeConnections,
  useNativeCatalogs,
} from "./connection-state.ts";
import { appsCopy, nativeMcpNotice } from "./copy.ts";
import "./style.css";

type Connection = Awaited<ReturnType<typeof client.mcp.list>>[number];
type App = Awaited<ReturnType<typeof client.mcp.catalog>>[number];

const draft = (computerId: string): Draft => ({
  id: crypto.randomUUID(),
  revision: 0,
  name: "",
  computerId,
  enabled: true,
  paste: "",
  transport: "http",
  address: "",
  args: "[]",
  settings: "{}",
  editing: false,
});

export function ConnectionCenter({
  onExit,
  bots,
  computers,
  defaultComputerId,
}: {
  onExit: () => void;
  bots: Pick<Bot, "id" | "name" | "avatar">[];
  computers: { id: string; name: string }[];
  defaultComputerId: string | null;
}) {
  const computerId =
    defaultComputerId ??
    (computers.length === 1 ? computers[0]?.id : undefined) ??
    "";
  const [view, setView] = useState<"apps" | "connected">("apps");
  const [page, setPage] = useState<"list" | "detail" | "catalog" | "native">(
    "list",
  );
  const managed = useReadState(managedConnections, true);
  const apps = useReadState(appCatalog, true);
  const items = managed.data ?? [];
  const catalog = apps.data ?? [];
  const [selectedId, setSelectedId] = useState<string>();
  const [appInfo, setAppInfo] = useState<App>();
  const [queries, setQueries] = useState({ apps: "", connected: "" });
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => draft(computerId));
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [step, setStep] = useState<"import" | "confirm">("confirm");
  const native = useNativeCatalogs(
    bots,
    view === "connected" || page === "native",
  );
  const position = useRef({ apps: 0, connected: 0 });
  const origin = useRef("");
  const setupSource = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const surface = document.querySelector<HTMLElement>(".connection-surface");
    if (!surface) return;
    surface.scrollTop = page === "list" ? position.current[view] : 0;
    if (page === "list" && origin.current)
      surface
        .querySelector<HTMLElement>(
          `[data-row-id="${CSS.escape(origin.current)}"]`,
        )
        ?.focus({ preventScroll: true });
    else if (page !== "list")
      surface
        .querySelector<HTMLElement>(".connection-path button")
        ?.focus({ preventScroll: true });
  }, [page, view]);
  const navigate = (next: typeof page) => {
    if (page === "list")
      position.current[view] =
        document.querySelector(".connection-surface")?.scrollTop ?? 0;
    setError(null);
    setPage(next);
  };
  const refresh = useCallback(async () => {
    await Promise.allSettled([
      managedConnections.load(true),
      appCatalog.load(true),
    ]);
  }, []);
  const authorizationPending = items.some((item) => item.authorizationPending);
  useEffect(() => {
    if (!authorizationPending) return;
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [authorizationPending, refresh]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败。请重试。");
    } finally {
      managedConnections.invalidate();
      await managedConnections.load().catch(() => {});
      setBusy(false);
    }
  };
  const change = (next: Partial<Draft>) =>
    setForm((value) => ({ ...value, ...next }));
  const setConfig = (name: string, config: McpConfig) => {
    setStep("confirm");
    setForm((value) => ({
      ...value,
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
  const start = (item?: Connection, app?: App) => {
    setupSource.current = document.activeElement as HTMLElement;
    setStep("confirm");
    setSetupOpen(true);
    setError(null);
    setAppInfo(app);
    setForm(
      item
        ? {
            ...draft(item.computerId),
            id: item.id,
            revision: item.revision,
            name: item.name,
            enabled: item.enabled,
            transport: item.transport,
            editing: true,
          }
        : draft(computerId),
    );
    if (app) setConfig(app.name, app.config);
  };
  const preview = () => {
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
  const people = bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    seed: bot.avatar,
    color: characterIdentity(bot.avatar).color,
  }));
  const computerName = (id: string) =>
    computers.find((pc) => pc.id === id)?.name ?? id;
  const summaries: ConnectionSummary[] = items
    .map((item): ConnectionSummary => {
      const status = item.enabled ? (item.status ?? "configured") : "disabled";
      return {
        id: item.id,
        name: item.name,
        kind: "managed",
        icon: catalog.find((app) => app.name === item.name)?.icon,
        description: `${computerName(item.computerId)} · ${item.transport === "http" ? "HTTP" : "本地命令"}`,
        membersLabel: item.grants.length
          ? item.grants
              .map(
                (grant) =>
                  bots.find((bot) => bot.id === grant.botId)?.name ??
                  String(grant.botId),
              )
              .join("、")
          : "尚未授权伙伴",
        status,
        statusLabel:
          checking === item.id
            ? "检查中…"
            : status === "disabled"
              ? "已禁用"
              : appsCopy.status[status],
        sources: [],
        tools: item.tools,
        grants: item.grants,
        transport: item.transport,
        checkedAt: item.checkedAt ?? undefined,
        capabilities:
          (item.capabilities &&
            [
              item.capabilities.tools && "工具",
              item.capabilities.resources && "资源",
              item.capabilities.prompts && "提示词",
            ]
              .filter(Boolean)
              .join(" · ")) ||
          undefined,
      };
    })
    .concat(nativeSummaries(native.sources, people));
  const selected = summaries.find((item) => item.id === selectedId);
  const connection = items.find((item) => item.id === selectedId);
  const readError = [
    view === "apps"
      ? apps.error && appsCopy.readError
      : managed.error && appsCopy.readError,
    ...(view === "connected" || page === "native"
      ? native.sources.map((source) => {
          const notice = source.error
            ? appsCopy.nativeReadError
            : source.data
              ? nativeMcpNotice(source.data)
              : "";
          return notice && `${source.bot.name} · ${notice}`;
        })
      : []),
  ]
    .filter(Boolean)
    .join("。 ");
  const refreshAll = () => {
    void refresh();
    if (view === "connected" || page === "native") void native.refresh();
  };
  return (
    <>
      {page === "catalog" && appInfo ? (
        <CatalogDetail
          app={appInfo}
          computer={computerName(computerId)}
          onBack={() => navigate("list")}
          onConnect={() => start(undefined, appInfo)}
        />
      ) : page === "detail" && selected ? (
        <ConnectionDetail
          key={selected.id}
          item={selected}
          bots={people}
          computer={computerName(
            connection?.computerId ?? defaultComputerId ?? "",
          )}
          onBack={() => navigate("list")}
          onEdit={() => connection && start(connection)}
          onTest={() =>
            connection
              ? void run(() => testConnection(connection.id))
              : void native.refresh()
          }
          onToggle={() =>
            connection &&
            void run(() =>
              client.mcp.save({
                id: connection.id,
                revision: connection.revision,
                name: connection.name,
                computerId: connection.computerId,
                enabled: !connection.enabled,
              }),
            )
          }
          onDelete={() =>
            connection &&
            void run(async () => {
              await client.mcp.remove({
                id: connection.id,
                revision: connection.revision,
              });
              origin.current = "";
              navigate("list");
            })
          }
          onGrant={(botId, tools) =>
            connection && grant(connection, botId, tools)
          }
          busy={busy || (selected.kind === "native" && native.loading)}
          notice={
            [error, connection?.error, readError].filter(Boolean).join("。 ") ||
            undefined
          }
          login={
            connection?.transport === "http" && (
              <ConnectionLogin item={connection} busy={busy} run={run} />
            )
          }
        />
      ) : page === "native" ? (
        <NativeConnectionSettings
          onBack={() => navigate("list")}
          items={native.sources
            .filter((source) => source.data?.inheritance === "selectable")
            .map((source) => ({
              botId: source.bot.id,
              name: source.bot.name,
              enabled: source.data?.inherited ?? false,
            }))}
          busy={busy}
          loading={native.loading}
          error={readError || error || undefined}
          onRefresh={refreshAll}
          onChange={(botId, enabled) =>
            void run(async () => {
              nativeConnections(botId).receive(
                await client.mcp.native({ botId, enabled }),
              );
            })
          }
        />
      ) : (
        <ConnectionPage
          view={view}
          onView={(next) => {
            position.current[view] =
              document.querySelector(".connection-surface")?.scrollTop ?? 0;
            origin.current = "";
            setView(next);
          }}
          query={queries[view]}
          onQuery={(query) =>
            setQueries((current) => ({ ...current, [view]: query }))
          }
          category={category}
          onCategory={setCategory}
          items={summaries}
          catalog={catalog}
          onOpen={(id) => {
            origin.current = id;
            setSelectedId(id);
            navigate("detail");
          }}
          onConnect={(id) => {
            origin.current = id;
            setAppInfo(catalog.find((app) => app.id === id));
            navigate("catalog");
          }}
          onAdd={() => start()}
          onSettings={() => navigate("native")}
          onExit={onExit}
          loading={
            view === "apps"
              ? apps.data === undefined && apps.loading
              : (managed.data === undefined && managed.loading) ||
                native.sources.some((source) => !source.data && source.loading)
          }
          refreshing={
            managed.loading ||
            apps.loading ||
            (view === "connected" && native.loading)
          }
          error={error || readError || undefined}
          onRefresh={refreshAll}
        />
      )}
      <ConnectionSetup
        key={form.id}
        open={setupOpen}
        finalFocus={() =>
          setupSource.current?.isConnected
            ? setupSource.current
            : document.querySelector<HTMLElement>(".connection-path button")
        }
        form={form}
        appInfo={appInfo}
        computers={computers}
        step={step}
        busy={busy}
        change={change}
        error={error || undefined}
        onBack={() => {
          setSetupOpen(false);
          setError(null);
        }}
        onContinue={preview}
        onImport={() => {
          setStep("import");
          setError(null);
        }}
        onManual={() => {
          setStep("confirm");
          setError(null);
        }}
        onSave={() =>
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
            setSelectedId(item.id);
            setQueries((current) => ({ ...current, connected: "" }));
            setView("connected");
            navigate("detail");
            setSetupOpen(false);
            if (item.enabled) await testConnection(item.id);
          })
        }
      />
    </>
  );
}
