import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { Checkbox } from "@domos/ui/field";
import { ExpandableCard } from "@domos/ui/panel";
import { Tooltip } from "@domos/ui/popover";
import { StatusDot } from "@domos/ui/status-dot";
import { BookOpenIcon } from "@phosphor-icons/react/dist/csr/BookOpen";
import { CodeIcon } from "@phosphor-icons/react/dist/csr/Code";
import { PlugIcon } from "@phosphor-icons/react/dist/csr/Plug";
import type { ReactNode } from "react";
import { useState } from "react";
import type { client } from "../../client.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import type { useNativeCatalogs } from "./connection-state.ts";
import { appsCopy, nativeMcpNotice, nativeMcpStatus } from "./copy.ts";

type Catalog = Awaited<ReturnType<typeof client.mcp.native>>;
type Native = Catalog["items"][number];
const engineNames: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
  grok: "Grok",
  antigravity: "Antigravity",
  devin: "Devin",
  cursor: "Cursor",
};

export function ConnectionHint({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<Button variant="ghost" size="icon-small" aria-label={label} />}
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="10" cy="10" r="7" />
          <path d="M10 9v5m0-9v1" />
        </svg>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner
          className="tooltip-positioner"
          sideOffset={8}
          collisionPadding={12}
        >
          <Tooltip.Popup className="tooltip-surface connection-hint">
            {children}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function ConnectionIcon({
  name,
  icon,
}: {
  name: string;
  icon?: string;
}) {
  if (name.toLowerCase() === "supabase")
    return (
      <img
        className="connection-brand"
        src={new URL("./assets/supabase.svg", import.meta.url).href}
        alt=""
      />
    );
  if (icon === "BookOpen") return <BookOpenIcon aria-hidden="true" />;
  if (icon === "Code") return <CodeIcon aria-hidden="true" />;
  return <PlugIcon aria-hidden="true" />;
}

export function ConnectionStatus({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  return (
    <StatusDot
      inline
      tone={
        status === "connected" || status === "ready"
          ? "positive"
          : status === "failed"
            ? "negative"
            : [
                  "pending",
                  "connecting",
                  "needs-auth",
                  "needs_auth",
                  "needs_client_registration",
                  "authorization_required",
                ].includes(status)
              ? "warning"
              : "neutral"
      }
      label={label}
    />
  );
}

export function NativeConnections({
  query,
  catalogs,
  busy,
  onInheritance,
}: {
  query: string;
  catalogs: ReturnType<typeof useNativeCatalogs>;
  busy: boolean;
  onInheritance: (botId: number, enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<string>();
  const groups = new Map<
    string,
    { bot: { id: number; name: string }; catalog: Catalog; item: Native }[]
  >();
  for (const source of catalogs.sources) {
    for (const item of source.data?.items ?? []) {
      if (!item.name.toLowerCase().includes(query.toLowerCase())) continue;
      const group = groups.get(item.name) ?? [];
      group.push({ bot: source.bot, catalog: source.data as Catalog, item });
      groups.set(item.name, group);
    }
  }
  return (
    <>
      {catalogs.sources.map((source) => {
        const notice = source.error
          ? appsCopy.nativeReadError
          : source.data
            ? nativeMcpNotice(source.data)
            : "";
        return (
          notice && (
            <p key={source.bot.id} role="alert">
              {source.bot.name} · {notice}
            </p>
          )
        );
      })}
      {groups.size > 0 && (
        <section className="apps-category" aria-label="引擎原生连接">
          <div className="connection-group-heading">
            <h3>引擎原生</h3>
            <ConnectionHint label="原生连接范围">
              配置由原生引擎管理。各 Bot 的来源、状态和工具目录分别保留。
            </ConnectionHint>
          </div>
          <div className="connection-grid">
            {Array.from(groups, ([name, sources]) => {
              const first = sources[0];
              if (!first) return null;
              return (
                <ExpandableCard
                  key={name}
                  title={name}
                  data-connection-action={`native:${name}`}
                  icon={<ConnectionIcon name={name} />}
                  description={
                    sources.length === 1 ? (
                      <>
                        <EngineMark provider={first.catalog.provider} />{" "}
                        {engineNames[first.catalog.provider] ??
                          first.catalog.provider}{" "}
                        · 只读
                      </>
                    ) : (
                      `${sources.length} 个来源 · 只读`
                    )
                  }
                  value={
                    sources.length === 1 ? (
                      <>
                        {first.item.tools !== undefined && (
                          <span>{first.item.tools.length} 个工具</span>
                        )}
                        <ConnectionStatus
                          status={first.item.status}
                          label={
                            first.item.status === "connected"
                              ? "已连接"
                              : nativeMcpStatus(first.item)
                          }
                        />
                      </>
                    ) : undefined
                  }
                  expanded={expanded === name}
                  onExpandedChange={(open) =>
                    setExpanded(open ? name : undefined)
                  }
                >
                  {sources.map(({ bot, catalog, item }) => (
                    <section
                      className="connection-source"
                      key={bot.id}
                      aria-label={`${bot.name} 的 ${name}`}
                    >
                      <div className="connection-source-heading">
                        <strong>{bot.name}</strong>
                        <span>
                          <EngineMark provider={catalog.provider} />{" "}
                          {engineNames[catalog.provider] ?? catalog.provider}
                        </span>
                      </div>
                      <div className="connection-state">
                        <ConnectionStatus
                          status={item.status}
                          label={nativeMcpStatus(item)}
                        />{" "}
                        {nativeMcpStatus(item)}
                      </div>
                      <ConnectionTools tools={item.tools} />
                      <Disclosure label="来源信息">
                        <dl className="connection-metadata">
                          <dt>目录</dt>
                          <dd>
                            {catalog.scope === "session"
                              ? "原生会话目录"
                              : "工作目录配置；不代表当前会话已挂载"}
                          </dd>
                          <dt>来源</dt>
                          <dd>{item.source}</dd>
                          <dt>读取时间</dt>
                          <dd>
                            {new Date(catalog.observedAt).toLocaleString()}
                          </dd>
                        </dl>
                      </Disclosure>
                    </section>
                  ))}
                </ExpandableCard>
              );
            })}
          </div>
        </section>
      )}
      {catalogs.sources.some(
        (source) => source.data?.inheritance === "selectable",
      ) && (
        <Disclosure label="原生连接设置">
          {catalogs.sources
            .filter((source) => source.data?.inheritance === "selectable")
            .map((source) => (
              <Checkbox
                key={source.bot.id}
                label={`${source.bot.name} · 在下一轮沿用原生连接`}
                checked={source.data?.inherited ?? false}
                disabled={busy}
                onCheckedChange={(enabled) =>
                  onInheritance(source.bot.id, enabled)
                }
              />
            ))}
        </Disclosure>
      )}
    </>
  );
}

export function ConnectionTools({ tools }: { tools?: Native["tools"] | null }) {
  return (
    <section className="connection-tools" aria-label="工具目录">
      {tools && tools.length > 0 && <h3>工具 · {tools.length}</h3>}
      {tools === undefined || tools === null ? (
        <p className="apps-muted">未提供工具目录</p>
      ) : tools.length === 0 ? (
        <p className="apps-muted">工具目录为空</p>
      ) : (
        tools.map((tool) => (
          <Disclosure key={tool.name} label={tool.name}>
            {tool.description && <p>{tool.description}</p>}
            {tool.inputSchema ? (
              <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
            ) : (
              <p className="apps-muted">未提供参数说明</p>
            )}
          </Disclosure>
        ))
      )}
    </section>
  );
}
