import type { Context } from "@earendil-works/chord/context";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { Harness } from "@earendil-works/pi-durable";
import { requireRevision, WorkError } from "../work/state.ts";
import { askJev, type DecisionProvider } from "./jev.ts";
import { ComputersDoc, requireComputer, requireIdle } from "./state.ts";

export class ComputerAssistance {
  private readonly harness: Harness;
  private readonly credentials?: CredentialStore;

  constructor(harness: Harness, credentials?: CredentialStore) {
    this.harness = harness;
    this.credentials = credentials;
  }

  private async key(provider: DecisionProvider) {
    const credential = await this.credentials?.read(
      `domos-computer:${provider}`,
    );
    return credential?.type === "api_key" ? credential.key : undefined;
  }

  async state(botId: number, context: Context) {
    const binding = (await this.harness.snapshot(ComputersDoc, context))
      ?.bindings[String(botId)];
    return {
      computerId: binding?.computerId ?? null,
      revision: binding?.revision ?? 0,
      enabled: binding?.assistance?.enabled ?? false,
      provider:
        binding?.assistance?.provider ?? ("typesafe" as DecisionProvider),
      configured: {
        typesafe: Boolean(await this.key("typesafe")),
        openrouter: Boolean(await this.key("openrouter")),
      },
      available: Boolean(this.credentials),
    };
  }

  async saveKey(provider: DecisionProvider, key: string) {
    if (!this.credentials) throw new Error("当前服务未配置凭据存储。");
    if (key)
      await this.credentials.modify(`domos-computer:${provider}`, async () => ({
        type: "api_key",
        key,
      }));
    else await this.credentials.delete(`domos-computer:${provider}`);
  }

  async test(provider: DecisionProvider, signal: AbortSignal) {
    const key = await this.key(provider);
    if (!key) throw new Error("请先保存这个来源的密钥。");
    const started = Date.now();
    const result = await askJev(
      provider,
      key,
      { value: "ready" },
      {
        connection: {
          type: "choice",
          instructions: "Select the value in state.",
          criteria: { ready: "ready", other: "other" },
        },
      },
      signal,
    );
    if (
      result.answers.connection?.type !== "choice" ||
      result.answers.connection.choice !== "ready"
    )
      throw new Error("辅助决策连接测试未通过。");
    return { model: result.model, milliseconds: Date.now() - started };
  }

  async configure(
    botId: number,
    input: {
      computerId: string;
      revision: number;
      enabled: boolean;
      provider: DecisionProvider;
    },
    context: Context,
  ) {
    if (input.enabled && !(await this.key(input.provider)))
      throw new Error("请先保存这个来源的密钥。");
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(ComputersDoc);
      const binding = doc.bindings[String(botId)];
      requireRevision(binding?.revision ?? 0, input.revision);
      if (!binding || binding.computerId !== input.computerId)
        throw new WorkError("CONFLICT", "工作电脑已改变。请刷新后重试。");
      if (!requireComputer(doc.items, input.computerId).authorized)
        throw new Error("请先授权工作电脑。");
      await requireIdle(tx, botId);
      binding.assistance = { enabled: input.enabled, provider: input.provider };
      binding.revision++;
    }, context);
    return this.state(botId, context);
  }

  async connect(botId: number, context: Context) {
    const binding = (await this.harness.snapshot(ComputersDoc, context))
      ?.bindings[String(botId)];
    const state = binding?.assistance;
    if (!state?.enabled) return;
    const key = await this.key(state.provider);
    if (!key) return;
    return { provider: state.provider, key };
  }
}
