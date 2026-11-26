import { Button } from "@domos/ui/controls";
import { SearchField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { Tabs } from "@domos/ui/tabs";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { PlugIcon } from "@phosphor-icons/react/dist/csr/Plug";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import type { ReactNode } from "react";
import type { ConnectionSummary } from "./connection-detail.tsx";
import { ConnectionIcon, ConnectionStatus } from "./connection-details.tsx";
import "./connection-page.css";

export function ConnectionSurface({
  title,
  path,
  onBack,
  backLabel,
  actions,
  icon,
  caption,
  children,
  detail = false,
}: {
  title: string;
  path?: string;
  onBack: () => void;
  backLabel: string;
  actions?: ReactNode;
  icon?: ReactNode;
  caption?: ReactNode;
  children: ReactNode;
  detail?: boolean;
}) {
  return (
    <section className="connection-surface" aria-label={title}>
      <div className="connection-page" data-detail={detail || undefined}>
        <nav className="connection-path" aria-label="页面路径">
          <Button variant="ghost" size="small" onClick={onBack}>
            <ArrowLeftIcon />
            {backLabel}
          </Button>
          {path && (
            <>
              <CaretRightIcon aria-hidden="true" />
              <span aria-current="page">{path}</span>
            </>
          )}
        </nav>
        <header className="connection-page-head">
          <div className="connection-page-title">
            {icon}
            <div>
              <h1>{title}</h1>
              {caption && <p>{caption}</p>}
            </div>
          </div>
          <div className="connection-page-actions">{actions}</div>
        </header>
        {children}
      </div>
    </section>
  );
}

export type CatalogApp = {
  id: string;
  name: string;
  icon?: string;
  category: string;
  description: string;
  preparation: string;
  documentation: string;
  examples: string[];
};

export function ConnectionPage({
  view,
  onView,
  query,
  onQuery,
  category,
  onCategory,
  items,
  catalog,
  onOpen,
  onConnect,
  onAdd,
  onSettings,
  onExit,
  loading,
  refreshing,
  error,
  onRefresh,
}: {
  view: "connected" | "apps";
  onView: (view: "connected" | "apps") => void;
  query: string;
  onQuery: (value: string) => void;
  category: string;
  onCategory: (value: string) => void;
  items: ConnectionSummary[];
  catalog: CatalogApp[];
  onOpen: (id: string) => void;
  onConnect: (id: string) => void;
  onAdd: () => void;
  onSettings: () => void;
  onExit: () => void;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  onRefresh: () => void;
}) {
  const categories = [...new Set(catalog.map((app) => app.category))];
  const matches = (value: string) =>
    value.toLowerCase().includes(query.trim().toLowerCase());
  const rows = items.filter((item) =>
    matches(`${item.name} ${item.description}`),
  );
  const apps = catalog.filter(
    (app) =>
      (!category || app.category === category) &&
      matches(`${app.name} ${app.description}`),
  );
  return (
    <ConnectionSurface
      title="连接中心"
      onBack={onExit}
      backLabel="返回聊天"
      caption="连接应用，让伙伴使用你的工具。"
      actions={
        <>
          <SearchField
            aria-label={view === "connected" ? "搜索连接" : "搜索应用"}
            placeholder={view === "connected" ? "搜索连接" : "搜索应用"}
            value={query}
            onValueChange={onQuery}
          />
          <Button
            variant="ghost"
            size="icon-small"
            aria-label="原生连接设置"
            onClick={onSettings}
          >
            <GearSixIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-small"
            aria-label="刷新连接"
            disabled={loading}
            pending={refreshing}
            onClick={onRefresh}
          >
            <ArrowClockwiseIcon />
          </Button>
          <Button size="small" className="connection-add" onClick={onAdd}>
            <PlusIcon />
            添加 MCP
          </Button>
        </>
      }
    >
      <div className="connection-toolbar">
        <Tabs.Root
          value={view}
          onValueChange={(next) => onView(next as typeof view)}
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
      </div>
      {error && (
        <div role="alert" className="connection-read-notice">
          <InlineNotice>{error}</InlineNotice>
          <Button variant="ghost" size="small" onClick={onRefresh}>
            重新读取
          </Button>
        </div>
      )}
      {loading ? (
        <div className="connection-empty">
          <Loading label="正在读取连接" />
        </div>
      ) : view === "connected" ? (
        <>
          {(["managed", "native"] as const).map((kind) => {
            const group = rows.filter((item) => item.kind === kind);
            return (
              group.length > 0 && (
                <section
                  className="connection-section"
                  key={kind}
                  aria-label={kind === "managed" ? "Domos 管理" : "引擎原生"}
                >
                  <div className="connection-section-heading">
                    <h2>{kind === "managed" ? "Domos 管理" : "引擎原生"}</h2>
                  </div>
                  <div className="connection-list">
                    {group.map((item) => (
                      <button
                        type="button"
                        className="connection-list-row"
                        data-row-id={item.id}
                        key={item.id}
                        onClick={() => onOpen(item.id)}
                      >
                        <span
                          className="connection-app-icon"
                          aria-hidden="true"
                        >
                          <ConnectionIcon name={item.name} icon={item.icon} />
                        </span>
                        <span className="connection-row-copy">
                          <strong>{item.name}</strong>
                          <span>{item.description}</span>
                          {kind === "managed" && (
                            <span className="connection-row-members">
                              {item.membersLabel}
                            </span>
                          )}
                        </span>
                        <span
                          className="connection-status-label"
                          title={item.statusLabel}
                        >
                          <span aria-hidden="true">
                            <ConnectionStatus
                              status={item.status}
                              label={item.statusLabel}
                            />
                          </span>
                          <span>{item.statusLabel}</span>
                        </span>
                        <CaretRightIcon
                          className="connection-row-caret"
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                  </div>
                </section>
              )
            );
          })}
          {rows.length === 0 && !error && (
            <div className="connection-empty">
              <PlugIcon aria-hidden="true" />
              <h2>{query ? "没有找到匹配的连接" : "还没有应用连接"}</h2>
              <p>
                {query
                  ? "试试其他名称，或清除搜索条件。"
                  : "连接应用后，伙伴就可以使用你授权的工具。"}
              </p>
              <Button
                size="small"
                variant="secondary"
                onClick={query ? () => onQuery("") : () => onView("apps")}
              >
                {query ? "清除搜索" : "发现应用"}
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <Tabs.Root value={category} onValueChange={onCategory}>
            <Tabs.List className="navigation-tabs" aria-label="应用分类">
              {["", ...categories].map((name) => (
                <Tabs.Tab className="navigation-tab" key={name} value={name}>
                  {name || "全部"}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.Root>
          <section className="connection-section" aria-label="应用目录">
            <h2>可连接的应用</h2>
            <div className="connection-catalog">
              {apps.map((app) => (
                <article className="connection-catalog-row" key={app.id}>
                  <button
                    type="button"
                    className="connection-catalog-link"
                    data-row-id={app.id}
                    onClick={() => onConnect(app.id)}
                  >
                    <span className="connection-app-icon" aria-hidden="true">
                      <ConnectionIcon name={app.name} icon={app.icon} />
                    </span>
                    <div>
                      <h3>{app.name}</h3>
                      <p>{app.description}</p>
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-small"
                    aria-label={`查看 ${app.name}`}
                    onClick={() => onConnect(app.id)}
                  >
                    <PlusIcon />
                  </Button>
                </article>
              ))}
            </div>
          </section>
          {apps.length === 0 && !error && (
            <div className="connection-empty">
              <h2>{catalog.length ? "没有找到匹配的应用" : "暂无可用应用"}</h2>
              <Button
                variant="ghost"
                onClick={() => {
                  onQuery("");
                  onCategory("");
                }}
              >
                清除筛选
              </Button>
            </div>
          )}
        </>
      )}
    </ConnectionSurface>
  );
}
