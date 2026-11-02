import { randomUUID } from "node:crypto";
import type { JsonRepresentation } from "@earendil-works/chord";
import type { Context } from "@earendil-works/chord/context";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import type { mcpOperation } from "../harness/mcp-client.mjs";
import { stored } from "../harness/task-types.ts";
import type { ProductTool } from "../harness/types.ts";
import { requiredText, requireRevision, WorkError } from "../work/state.ts";

import type { McpConfig } from "./config.ts";

export type { McpConfig } from "./config.ts";

export type McpConnection = {
  id: string;
  name: string;
  computerId: string;
  transport: McpConfig["transport"];
  enabled: boolean;
  grants: { botId: number; tools: string[] | null }[];
  revision: number;
  generation: number;
  status?: "configured" | "ready" | "authorization_required" | "failed";
  authorizationPending?: boolean;
  checkedAt?: number;
  error?: string;
  tools?: JsonRepresentation<ProductTool>[];
  capabilities?: import("@earendil-works/pi-durable").JsonObject;
};

type Secret = {
  config: McpConfig;
  oauth?: Record<string, unknown>;
  redirectUrl?: string;
  pending?: string;
};
export type McpOperation = Parameters<typeof mcpOperation>[0];
export type McpRunner = (
  computerId: string,
  input: McpOperation,
  signal?: AbortSignal,
) => Promise<Awaited<ReturnType<typeof mcpOperation>>>;

type StoredConnection = McpConnection & { credential: string };

export const McpConnectionsDoc = defineDoc<{
  items: StoredConnection[];
  native?: Record<string, boolean>;
}>({
  kind: "domos.mcp-connections",
  version: 1,
  checkpointWhen: () => false,
  scope: "session",
  initial: () => ({ items: [] }),
});

function visible({
  credential: _credential,
  ...item
}: StoredConnection): McpConnection {
  return stored(item);
}

export class McpConnections {
  private readonly harness: Harness;
  private readonly credentials?: CredentialStore;
  runner?: McpRunner;
  nativeCatalog?: (
    botId: number,
    context: Context,
  ) => Promise<{
    provider: string;
    computerId: string;
    items: { name: string; source: string; enabled: boolean; status: string }[];
    inheritance: string;
    readonly: boolean;
    inherited: boolean;
  }>;
  constructor(harness: Harness, credentials?: CredentialStore) {
    this.harness = harness;
    this.credentials = credentials;
  }

  async list(context: Context): Promise<McpConnection[]> {
    return (
      (await this.harness.snapshot(McpConnectionsDoc, context))?.items ?? []
    ).map(visible);
  }

  async native(botId: number, context: Context, enabled?: boolean) {
    if (enabled !== undefined)
      await this.harness.commit(async (tx) => {
        const doc = await tx.doc(McpConnectionsDoc);
        doc.native ??= {};
        doc.native[String(botId)] = enabled;
      }, context);
    return (
      (await this.harness.snapshot(McpConnectionsDoc, context))?.native?.[
        String(botId)
      ] ?? true
    );
  }

  async save(
    input: {
      id: string;
      revision: number;
      name: string;
      computerId: string;
      enabled: boolean;
      config?: McpConfig;
    },
    context: Context,
  ): Promise<McpConnection> {
    if (!this.credentials)
      throw new WorkError("BAD_REQUEST", "凭据存储不可用。");
    const name = requiredText(input.name, 128);
    const computerId = requiredText(input.computerId, 128);
    if (name.toLowerCase() === "domos")
      throw new WorkError("BAD_REQUEST", "此名称已保留。");
    const current = input.revision
      ? await this.secret(input.id, context)
      : undefined;
    const config = input.config ?? current?.secret.config;
    if (!config) throw new WorkError("BAD_REQUEST", "请填写连接配置。");
    if (config.transport === "http") {
      let url: URL;
      try {
        url = new URL(config.url);
      } catch {
        throw new WorkError("BAD_REQUEST", "MCP 地址无效。");
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new WorkError("BAD_REQUEST", "MCP 地址无效。");
    } else requiredText(config.command, 4096);
    const credential = `domos-mcp:${input.id}:${randomUUID()}`;
    await this.credentials.modify(credential, async () => ({
      type: "api_key",
      key: JSON.stringify(input.config ? { config } : current?.secret),
    }));
    let previous: string | undefined;
    let saved: McpConnection;
    try {
      saved = await this.harness.commit(async (tx) => {
        const doc = await tx.doc(McpConnectionsDoc);
        const existing = doc.items.find((item) => item.id === input.id);
        requireRevision(existing?.revision ?? 0, input.revision);
        if (
          doc.items.some(
            (item) =>
              item.id !== input.id &&
              item.name.toLowerCase() === name.toLowerCase(),
          )
        )
          throw new WorkError("CONFLICT", "连接名称已存在。");
        previous = existing?.credential;
        const next: StoredConnection = {
          id: input.id,
          name,
          computerId,
          transport: config.transport,
          enabled: input.enabled,
          grants: existing?.grants ?? [],
          revision: input.revision + 1,
          generation: (existing?.generation ?? 0) + 1,
          credential,
          status: "configured",
        };
        if (existing) doc.items.splice(doc.items.indexOf(existing), 1, next);
        else doc.items.push(next);
        return visible(next);
      }, context);
    } catch (error) {
      await this.credentials.delete(credential);
      throw error;
    }
    if (previous) await this.credentials.delete(previous);
    return saved;
  }

  async grant(
    id: string,
    revision: number,
    grants: McpConnection["grants"],
    context: Context,
  ) {
    if (new Set(grants.map((grant) => grant.botId)).size !== grants.length)
      throw new WorkError("BAD_REQUEST", "Bot 权限重复。");
    return this.harness.commit(async (tx) => {
      const item = (await tx.doc(McpConnectionsDoc)).items.find(
        (entry) => entry.id === id,
      );
      if (!item) throw new WorkError("NOT_FOUND", "连接不存在。");
      requireRevision(item.revision, revision);
      item.grants = grants.map((grant) => ({
        botId: grant.botId,
        tools: grant.tools && [...new Set(grant.tools)],
      }));
      item.revision++;
      return visible(item);
    }, context);
  }

  async remove(id: string, revision: number, context: Context) {
    const credential = await this.harness.commit(async (tx) => {
      const doc = await tx.doc(McpConnectionsDoc);
      const index = doc.items.findIndex((entry) => entry.id === id);
      const item = doc.items[index];
      if (!item) throw new WorkError("NOT_FOUND", "连接不存在。");
      requireRevision(item.revision, revision);
      doc.items.splice(index, 1);
      return item.credential;
    }, context);
    await this.credentials?.delete(credential);
  }

  async resolve(
    id: string,
    botId: number,
    computerId: string,
    context: Context,
  ) {
    const item = (
      await this.harness.snapshot(McpConnectionsDoc, context)
    )?.items.find((entry) => entry.id === id);
    const grant = item?.grants.find((entry) => entry.botId === botId);
    if (!item?.enabled || item.computerId !== computerId || !grant)
      throw new WorkError("NOT_FOUND", "连接不可用或未授权。");
    return {
      connection: visible(item),
      ...(await this.secret(id, context)).secret,
      tools: grant.tools,
    };
  }

  private async secret(id: string, context: Context) {
    const item = (
      await this.harness.snapshot(McpConnectionsDoc, context)
    )?.items.find((entry) => entry.id === id);
    if (!item) throw new WorkError("NOT_FOUND", "连接不存在。");
    const value = await this.credentials?.read(item.credential);
    if (value?.type !== "api_key" || !value.key)
      throw new WorkError("BAD_REQUEST", "连接凭据不可用。");
    return { item, secret: JSON.parse(value.key) as Secret };
  }

  private async store(item: StoredConnection, secret: Secret) {
    await this.credentials?.modify(item.credential, async (current) => {
      if (!current) throw new WorkError("CONFLICT", "连接已更改，请重新操作。");
      return { type: "api_key", key: JSON.stringify(secret) };
    });
  }

  async check(id: string, context: Context, signal?: AbortSignal) {
    const { item, secret } = await this.secret(id, context);
    if (!item.enabled) throw new WorkError("BAD_REQUEST", "连接已禁用。");
    if (!this.runner)
      throw new WorkError("BAD_REQUEST", "连接执行服务不可用。");
    let result: Awaited<ReturnType<McpRunner>> | undefined;
    try {
      result = await this.runner(
        item.computerId,
        { action: "inspect", ...secret },
        signal,
      );
      if (!result.tools || !result.capabilities)
        throw new Error("MCP 能力响应无效。");
      await this.store(item, { ...secret, oauth: result.oauth });
    } catch (error) {
      signal?.throwIfAborted();
      const authorization = (error as { code?: string }).code === "MCP_AUTH";
      await this.harness.commit(async (tx) => {
        const live = (await tx.doc(McpConnectionsDoc)).items.find(
          (entry) => entry.id === id,
        );
        if (live?.revision !== item.revision) return;
        live.status = authorization ? "authorization_required" : "failed";
        live.checkedAt = Date.now();
        live.error = authorization
          ? "请登录 MCP 服务。"
          : "连接失败。请检查程序、地址、网络和授权。";
      }, context);
      return visible((await this.secret(id, context)).item);
    }
    await this.harness.commit(async (tx) => {
      const live = (await tx.doc(McpConnectionsDoc)).items.find(
        (entry) => entry.id === id,
      );
      if (live?.revision !== item.revision || !result) return;
      live.status = "ready";
      live.checkedAt = Date.now();
      delete live.error;
      live.tools = stored(result.tools);
      live.capabilities = stored(result.capabilities);
    }, context);
    return visible((await this.secret(id, context)).item);
  }

  async login(
    id: string,
    redirectUrl: string,
    client: { client_id: string; client_secret?: string } | undefined,
    context: Context,
  ) {
    const { item, secret } = await this.secret(id, context);
    if (!item.enabled || secret.config.transport !== "http")
      throw new WorkError("BAD_REQUEST", "此连接不能使用浏览器登录。");
    if (!this.runner)
      throw new WorkError("BAD_REQUEST", "连接执行服务不可用。");
    const state = `${id}.${randomUUID()}`;
    const result = await this.runner(item.computerId, {
      action: "authorize",
      config: secret.config,
      oauth: client ? { client } : {},
      redirectUrl,
      state,
    });
    await this.store(item, {
      ...secret,
      oauth: result.oauth,
      redirectUrl,
      pending: state,
    });
    await this.harness.commit(async (tx) => {
      const live = (await tx.doc(McpConnectionsDoc)).items.find(
        (entry) => entry.id === id,
      );
      if (live?.revision === item.revision)
        live.authorizationPending = !!result.authorizationUrl;
    }, context);
    if (!result.authorizationUrl) {
      await this.check(id, context);
      return { url: null };
    }
    return { url: result.authorizationUrl as string };
  }

  async complete(state: string, code: string, context: Context) {
    const id = state.slice(0, state.indexOf("."));
    const { item, secret } = await this.secret(id, context);
    if (!secret.pending || secret.pending !== state || !this.runner)
      throw new WorkError("BAD_REQUEST", "授权请求已失效。");
    const result = await this.runner(item.computerId, {
      action: "complete",
      ...secret,
      state,
      authorizationCode: code,
    });
    const current = await this.secret(id, context);
    if (
      current.secret.pending !== state ||
      current.item.revision !== item.revision
    )
      throw new WorkError("CONFLICT", "授权已取消或连接已更改。");
    await this.store(item, {
      config: secret.config,
      oauth: result.oauth,
      redirectUrl: secret.redirectUrl,
    });
    await this.harness.commit(async (tx) => {
      const live = (await tx.doc(McpConnectionsDoc)).items.find(
        (entry) => entry.id === id,
      );
      if (live?.revision === item.revision) delete live.authorizationPending;
    }, context);
    return this.check(id, context);
  }

  async logout(id: string, context: Context, cancel = false) {
    const { item, secret } = await this.secret(id, context);
    delete secret.pending;
    if (!cancel) delete secret.oauth;
    await this.store(item, secret);
    await this.save(
      {
        id,
        revision: item.revision,
        name: item.name,
        computerId: item.computerId,
        enabled: item.enabled,
      },
      context,
    );
  }

  async saveOAuth(
    id: string,
    generation: number,
    oauth: Record<string, unknown>,
    context: Context,
  ) {
    const { item, secret } = await this.secret(id, context);
    requireRevision(item.generation, generation);
    await this.store(item, { ...secret, oauth });
  }
}
