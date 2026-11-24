import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { PanelRow } from "@domos/ui/panel";
import { Tooltip } from "@domos/ui/popover";
import { StatusDot } from "@domos/ui/status-dot";
import { BookOpenIcon } from "@phosphor-icons/react/dist/csr/BookOpen";
import { CodeIcon } from "@phosphor-icons/react/dist/csr/Code";
import type { ReactNode } from "react";
import type { client } from "../../client.ts";
import { EngineMark } from "../bots/engine-mark.tsx";
import { nativeMcpStatus } from "./copy.ts";

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
  if (icon === "BookOpen") return <BookOpenIcon aria-hidden="true" />;
  if (icon === "Code") return <CodeIcon aria-hidden="true" />;
  return (
    <span aria-hidden="true">{Array.from(name)[0]?.toUpperCase() || "M"}</span>
  );
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
  catalog,
  query,
  onSelect,
}: {
  catalog: Catalog;
  query: string;
  onSelect: (name: string) => void;
}) {
  const rows = catalog.items.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase()),
  );
  if (!rows.length) return null;
  return (
    <section className="apps-category" aria-label="引擎原生连接">
      <div className="connection-group-heading">
        <h3>
          引擎原生 · <EngineMark provider={catalog.provider} />{" "}
          {engineNames[catalog.provider] ?? catalog.provider}（只读）
        </h3>
        <ConnectionHint label="原生连接范围">
          只读。
          {catalog.scope === "session"
            ? "目录来自原生会话。"
            : "目录来自工作目录配置，不代表当前会话已挂载。"}
          配置由原生引擎管理。
        </ConnectionHint>
      </div>
      <div>
        {rows.map((item) => (
          <PanelRow
            key={item.name}
            variant="navigation"
            aria-label={`查看 ${item.name}`}
            data-connection-action={`native:${item.name}`}
            icon={<ConnectionIcon name={item.name} />}
            title={item.name}
            description={
              item.error ||
              (item.status === "connected" ? undefined : nativeMcpStatus(item))
            }
            value={
              <>
                {item.tools !== undefined && (
                  <span>{item.tools.length} 个工具</span>
                )}
                <ConnectionStatus
                  status={item.status}
                  label={
                    item.status === "connected"
                      ? "已连接"
                      : nativeMcpStatus(item)
                  }
                />
              </>
            }
            onClick={() => onSelect(item.name)}
          />
        ))}
      </div>
    </section>
  );
}

export function NativeConnectionDetails({
  item,
  catalog,
}: {
  item: Native;
  catalog: Catalog;
}) {
  return (
    <section className="connection-details">
      <div className="connection-identity">
        <span className="connection-icon">
          <ConnectionIcon name={item.name} />
        </span>
        <div>
          <h3>{item.name}</h3>
          <p className="apps-muted">
            <EngineMark provider={catalog.provider} />{" "}
            {engineNames[catalog.provider] ?? catalog.provider} · 只读
          </p>
        </div>
      </div>
      <p>
        <ConnectionStatus
          status={item.status}
          label={item.status === "connected" ? "已连接" : nativeMcpStatus(item)}
        />{" "}
        {nativeMcpStatus(item)}
      </p>
      <p className="apps-muted">
        {catalog.scope === "session"
          ? "原生会话目录"
          : "工作目录配置；不代表当前会话已挂载"}{" "}
        · {new Date(catalog.observedAt).toLocaleString()}
      </p>
      <ConnectionTools tools={item.tools} />
    </section>
  );
}

export function ConnectionTools({ tools }: { tools?: Native["tools"] | null }) {
  return (
    <section className="connection-tools" aria-label="工具目录">
      <h3>工具{tools ? ` · ${tools.length}` : ""}</h3>
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
