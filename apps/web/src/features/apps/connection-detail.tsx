import { BotAvatar, EngineMark } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Checkbox } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { InlineNotice } from "@domos/ui/message";
import { PanelCard } from "@domos/ui/panel";
import { Tabs } from "@domos/ui/tabs";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import {
  ConnectionIcon,
  ConnectionStatus,
  ConnectionTools,
} from "./connection-details.tsx";
import { type CatalogApp, ConnectionSurface } from "./connection-page.tsx";

export type ConnectionSource = {
  id: string;
  bot: { id: number; name: string; seed: string; color: string };
  provider: string;
  providerLabel: string;
  status: string;
  statusLabel: string;
  scope: string;
  origin: string;
  observedAt?: number;
  tools?: ComponentProps<typeof ConnectionTools>["tools"];
};

export type ConnectionSummary = {
  id: string;
  name: string;
  icon?: string;
  kind: "managed" | "native";
  description: string;
  membersLabel: string;
  status: string;
  statusLabel: string;
  sources: ConnectionSource[];
  tools?: ComponentProps<typeof ConnectionTools>["tools"];
  grants: { botId: number; tools: string[] | null }[];
  transport?: string;
  checkedAt?: number;
  capabilities?: string;
};

export function ConnectionDetail({
  item,
  computer,
  bots,
  onBack,
  onEdit,
  onTest,
  onToggle,
  onDelete,
  onGrant,
  login,
  busy,
  notice,
}: {
  item: ConnectionSummary;
  computer: string;
  bots: ConnectionSource["bot"][];
  onBack: () => void;
  onEdit: () => void;
  onTest: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onGrant: (botId: number, tools: string[] | null | undefined) => void;
  login?: ReactNode;
  busy: boolean;
  notice?: string;
}) {
  const [tab, setTab] = useState("overview");
  const [removing, setRemoving] = useState(false);
  const managed = item.kind === "managed";
  return (
    <ConnectionSurface
      detail
      title={item.name}
      path={item.name}
      onBack={onBack}
      backLabel="连接中心"
      icon={
        <span
          className="connection-app-icon"
          data-size="large"
          aria-hidden="true"
        >
          <ConnectionIcon name={item.name} icon={item.icon} />
        </span>
      }
      caption={
        <>
          <span className="connection-status-label">
            <span aria-hidden="true">
              <ConnectionStatus status={item.status} label={item.statusLabel} />
            </span>
            {item.statusLabel}
          </span>
          <span>{managed ? "Domos 管理" : "引擎原生 · 配置只读"}</span>
        </>
      }
      actions={
        managed ? (
          <>
            <Button
              variant="secondary"
              size="small"
              pending={busy}
              onClick={onTest}
            >
              测试连接
            </Button>
            <Button
              variant="secondary"
              size="small"
              disabled={busy}
              onClick={onEdit}
            >
              编辑
            </Button>
            <ActionMenu
              label="连接操作"
              disabled={busy}
              items={[
                {
                  label: item.status === "disabled" ? "启用" : "停用",
                  onSelect: onToggle,
                },
                {
                  label: "删除连接",
                  tone: "danger",
                  onSelect: () => setRemoving(true),
                },
              ]}
            />
          </>
        ) : (
          <Button
            variant="secondary"
            size="small"
            pending={busy}
            onClick={onTest}
          >
            刷新来源
          </Button>
        )
      }
    >
      {notice && (
        <div role="status">
          <InlineNotice>{notice}</InlineNotice>
        </div>
      )}
      {removing && (
        <PanelCard className="connection-delete-confirm">
          <div>
            <strong>删除 {item.name}？</strong>
            <p>此连接的伙伴授权也会移除。</p>
          </div>
          <div className="connection-page-actions">
            <Button
              variant="ghost"
              size="small"
              onClick={() => setRemoving(false)}
            >
              取消
            </Button>
            <Button size="small" disabled={busy} onClick={onDelete}>
              确认删除
            </Button>
          </div>
        </PanelCard>
      )}
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="navigation-tabs" aria-label="连接详情">
          <Tabs.Tab className="navigation-tab" value="overview">
            概览
          </Tabs.Tab>
          <Tabs.Tab className="navigation-tab" value="tools">
            工具
          </Tabs.Tab>
          {managed && (
            <Tabs.Tab className="navigation-tab" value="permissions">
              伙伴权限
            </Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value="overview" className="connection-detail-body">
          {login}
          <section className="connection-section">
            <div className="connection-section-heading">
              <h2>连接信息</h2>
            </div>
            <div>
              <dl className="connection-facts">
                <div>
                  <dt>运行／访问电脑</dt>
                  <dd>{computer}</dd>
                </div>
                <div>
                  <dt>管理方式</dt>
                  <dd>{managed ? "由 Domos 配置" : "由原生 Harness 管理"}</dd>
                </div>
                <div>
                  <dt>{managed ? "已授权伙伴" : "来源"}</dt>
                  <dd>{item.membersLabel}</dd>
                </div>
                {managed && (
                  <div>
                    <dt>工具目录</dt>
                    <dd>
                      {item.tools == null
                        ? "未提供"
                        : `${item.tools.length} 个工具`}
                    </dd>
                  </div>
                )}
              </dl>
              {managed && (
                <dl className="connection-facts">
                  <div>
                    <dt>传输方式</dt>
                    <dd>{item.transport}</dd>
                  </div>
                  {item.checkedAt != null && (
                    <div>
                      <dt>上次检查</dt>
                      <dd>{new Date(item.checkedAt).toLocaleString()}</dd>
                    </div>
                  )}
                  {item.capabilities && (
                    <div>
                      <dt>能力</dt>
                      <dd>{item.capabilities}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          </section>
          {!managed && (
            <section className="connection-section">
              <div className="connection-section-heading">
                <h2>
                  各伙伴的来源<span>{item.sources.length}</span>
                </h2>
              </div>
              <div className="connection-sources">
                {item.sources.map((source) => (
                  <div className="connection-source-card" key={source.id}>
                    <div className="connection-source-top">
                      <div className="connection-person">
                        <BotAvatar
                          botId={source.bot.id}
                          seed={source.bot.seed}
                          color={source.bot.color}
                          size="small"
                        />
                        <div>
                          <strong>{source.bot.name}</strong>
                          <span>
                            <EngineMark provider={source.provider} />
                            {source.providerLabel}
                          </span>
                        </div>
                      </div>
                      <span className="connection-status-label">
                        <span aria-hidden="true">
                          <ConnectionStatus
                            status={source.status}
                            label={source.statusLabel}
                          />
                        </span>
                        {source.statusLabel}
                      </span>
                    </div>
                    <dl className="connection-source-facts">
                      <dt>范围</dt>
                      <dd>{source.scope}</dd>
                      <dt>来源</dt>
                      <dd>{source.origin}</dd>
                      {source.observedAt != null && (
                        <>
                          <dt>读取时间</dt>
                          <dd>
                            {new Date(source.observedAt).toLocaleString()}
                          </dd>
                        </>
                      )}
                      <dt>工具</dt>
                      <dd>
                        {source.tools == null
                          ? "未提供目录"
                          : `${source.tools.length} 个工具`}
                      </dd>
                    </dl>
                  </div>
                ))}
              </div>
            </section>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="tools" className="connection-detail-body">
          {managed ? (
            <ConnectionTools tools={item.tools} />
          ) : (
            item.sources.map((source) => (
              <section className="connection-section" key={source.id}>
                <div className="connection-section-heading">
                  <h2>
                    {source.bot.name}
                    <span>{source.providerLabel}</span>
                  </h2>
                </div>
                <ConnectionTools tools={source.tools} />
              </section>
            ))
          )}
        </Tabs.Panel>
        {managed && (
          <Tabs.Panel value="permissions" className="connection-detail-body">
            <section className="connection-section">
              <div className="connection-section-heading">
                <h2>允许使用此连接的伙伴</h2>
              </div>
              <div>
                {bots.map((bot) => {
                  const grant = item.grants.find(
                    (entry) => entry.botId === bot.id,
                  );
                  return (
                    <div className="connection-grant-row" key={bot.id}>
                      <div className="connection-person">
                        <BotAvatar
                          seed={bot.seed}
                          botId={bot.id}
                          color={bot.color}
                          size="small"
                        />
                        <strong>{bot.name}</strong>
                        <Checkbox
                          label={`${bot.name}允许使用`}
                          checked={Boolean(grant)}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            onGrant(bot.id, checked ? null : undefined)
                          }
                        />
                      </div>
                      {grant && (
                        <div className="connection-grant-tools">
                          <Checkbox
                            label="全部工具"
                            checked={grant.tools === null}
                            disabled={busy}
                            onCheckedChange={(checked) =>
                              onGrant(bot.id, checked ? null : [])
                            }
                          />
                          {item.tools?.map((tool) => (
                            <Checkbox
                              key={tool.name}
                              label={tool.name}
                              checked={
                                grant.tools === null ||
                                grant.tools.includes(tool.name)
                              }
                              disabled={busy}
                              onCheckedChange={(checked) => {
                                const selected =
                                  grant.tools ??
                                  item.tools?.map((entry) => entry.name) ??
                                  [];
                                onGrant(
                                  bot.id,
                                  checked
                                    ? [...new Set([...selected, tool.name])]
                                    : selected.filter(
                                        (name) => name !== tool.name,
                                      ),
                                );
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </Tabs.Panel>
        )}
      </Tabs.Root>
    </ConnectionSurface>
  );
}

export function CatalogDetail({
  app,
  computer,
  onBack,
  onConnect,
}: {
  app: CatalogApp;
  computer: string;
  onBack: () => void;
  onConnect: () => void;
}) {
  return (
    <ConnectionSurface
      detail
      title={app.name}
      path={app.name}
      onBack={onBack}
      backLabel="连接中心"
      icon={
        <span
          className="connection-app-icon"
          data-size="large"
          aria-hidden="true"
        >
          <ConnectionIcon name={app.name} icon={app.icon} />
        </span>
      }
      caption={app.description}
      actions={
        <Button size="small" className="connection-add" onClick={onConnect}>
          <PlusIcon />
          连接应用
        </Button>
      }
    >
      <div className="connection-app-preview">
        {app.examples.map((example) => (
          <p className="connection-preview-message" key={example}>
            <span className="connection-preview-app">
              <ConnectionIcon name={app.name} icon={app.icon} />
              {app.name}
            </span>
            <span>{example}</span>
          </p>
        ))}
      </div>
      <p className="connection-app-preparation">{app.preparation}</p>
      <section className="connection-section">
        <h2>连接信息</h2>
        <dl className="connection-facts">
          <div>
            <dt>工作电脑</dt>
            <dd>{computer}</dd>
          </div>
          <div>
            <dt>分类</dt>
            <dd>{app.category}</dd>
          </div>
          <div>
            <dt>设置说明</dt>
            <dd>
              <a href={app.documentation} target="_blank" rel="noreferrer">
                官方文档 <ArrowUpRightIcon />
              </a>
            </dd>
          </div>
        </dl>
      </section>
    </ConnectionSurface>
  );
}
