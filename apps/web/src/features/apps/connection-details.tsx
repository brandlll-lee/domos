import { Disclosure } from "@domos/ui/disclosure";
import { StatusDot } from "@domos/ui/status-dot";
import { BookOpenIcon } from "@phosphor-icons/react/dist/csr/BookOpen";
import { CodeIcon } from "@phosphor-icons/react/dist/csr/Code";
import { PlugIcon } from "@phosphor-icons/react/dist/csr/Plug";
import type { client } from "../../client.ts";
import type {
  ConnectionSource,
  ConnectionSummary,
} from "./connection-detail.tsx";
import type { useNativeCatalogs } from "./connection-state.ts";
import { nativeMcpStatus } from "./copy.ts";

type Catalog = Awaited<ReturnType<typeof client.mcp.native>>;
type Native = Catalog["items"][number];
export function nativeSummaries(
  sources: ReturnType<typeof useNativeCatalogs>["sources"],
  bots: ConnectionSource["bot"][],
): ConnectionSummary[] {
  const groups = new Map<string, ConnectionSource[]>();
  for (const source of sources) {
    const catalog = source.data;
    const bot = bots.find((bot) => bot.id === source.bot.id);
    if (!catalog || !bot) continue;
    for (const item of catalog.items) {
      const group = groups.get(item.name) ?? [];
      group.push({
        id: `${bot.id}:${item.name}`,
        bot,
        provider: catalog.provider,
        providerLabel: engineNames[catalog.provider] ?? catalog.provider,
        status: item.enabled === false ? "disabled" : item.status,
        statusLabel: nativeMcpStatus(item),
        scope:
          catalog.scope === "session"
            ? "原生会话目录"
            : "工作目录配置；不代表当前会话已挂载",
        origin: item.source,
        observedAt: catalog.observedAt,
        tools: item.tools,
      });
      groups.set(item.name, group);
    }
  }
  return Array.from(groups, ([name, sources]) => {
    const first = sources[0];
    const same = sources.every(
      (source) =>
        source.status === first?.status &&
        source.statusLabel === first?.statusLabel,
    );
    return {
      id: `native:${name}`,
      name,
      kind: "native",
      description: `${[...new Set(sources.map((source) => source.providerLabel))].join("、")} · ${sources.length} 个来源 · 只读`,
      membersLabel: sources.map((source) => source.bot.name).join("、"),
      status: same ? (first?.status ?? "unknown") : "mixed",
      statusLabel: same ? (first?.statusLabel ?? "连接状态未知") : "状态不一",
      sources,
      grants: [],
    };
  });
}
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
