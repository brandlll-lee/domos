import { RequestError } from "@agentclientprotocol/sdk";
import { z } from "zod";
import { mcpCatalog } from "../mcp-catalog.ts";
import { acpProvider } from "./acp.ts";

export const grokProvider = acpProvider({
  id: "grok",
  name: "Grok",
  command: "grok",
  package: "",
  login: ["login", "--device-auth"],
  async sessionQuota(rpc) {
    const source = "grok._x.ai/billing";
    const { config } = z
      .object({
        config: z
          .object({
            creditUsagePercent: z.number().min(0).max(100).optional(),
            currentPeriod: z
              .object({
                start: z.iso.datetime({ offset: true }),
                end: z.iso.datetime({ offset: true }),
              })
              .optional(),
          })
          .optional(),
      })
      .parse(await rpc.extMethod("_x.ai/billing", {}));
    const windows =
      config?.creditUsagePercent === undefined
        ? []
        : [
            {
              id: "credits",
              name: "积分周期",
              usedPercent: config.creditUsagePercent,
              durationMinutes: config.currentPeriod
                ? (Date.parse(config.currentPeriod.end) -
                    Date.parse(config.currentPeriod.start)) /
                  60000
                : null,
              resetsAt: config.currentPeriod
                ? Date.parse(config.currentPeriod.end)
                : null,
            },
          ];
    return {
      source,
      observedAt: Date.now(),
      status: windows.length ? "ready" : "empty",
      windows,
    };
  },
  async sessionMcp(rpc, sessionId) {
    const result = z
      .object({
        servers: z.array(
          z.object({
            name: z.string(),
            source: z.string(),
            sourceLabel: z.string().optional(),
            session: z
              .object({
                enabled: z.boolean(),
                status: z.string().optional(),
                authRequired: z.boolean().optional(),
              })
              .optional(),
          }),
        ),
      })
      .parse(await rpc.extMethod("_x.ai/mcp/list", { sessionId }));
    return mcpCatalog(
      result.servers.map((server) => ({
        name: server.name,
        source: server.sourceLabel ?? server.source,
        enabled: server.session?.enabled ?? null,
        status: server.session?.status ?? "unknown",
        authStatus:
          server.session?.authRequired === true ? "required" : "unknown",
      })),
      "session",
    );
  },
  async question(method, params, ask) {
    if (method !== "_x.ai/ask_user_question")
      throw new Error("Grok 请求了不支持的交互。");
    const { questions } = z
      .object({
        questions: z
          .array(
            z.object({
              question: z.string().min(1),
              options: z
                .array(
                  z.object({
                    label: z.string(),
                    description: z.string().optional(),
                  }),
                )
                .optional(),
              multiSelect: z.boolean().optional(),
              multi_select: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(20),
      })
      .parse(params);
    const answer = await ask({
      id: "",
      kind: "question",
      title: "需要你的回答",
      detail: "",
      questions: questions.map((item, index) => ({
        id: String(index),
        title: item.question,
        multiple: item.multiSelect ?? item.multi_select ?? false,
        allowOther: true,
        options: item.options?.map((option) => ({
          id: option.label,
          ...option,
        })),
      })),
    });
    if (!answer.allow) return { outcome: "cancelled" };
    return {
      outcome: "accepted",
      answers: Object.fromEntries(
        questions.map((item, index) => [
          item.question,
          answer.answers?.[String(index)] ?? (answer.text ? [answer.text] : []),
        ]),
      ),
    };
  },
  args: (config) => [
    "--permission-mode",
    config.approvalMode === "full"
      ? "bypassPermissions"
      : config.approvalMode === "auto"
        ? "auto"
        : "default",
    "agent",
    "stdio",
  ],
  async steer(rpc, sessionId, blocks, requestId) {
    try {
      await rpc.extMethod("_x.ai/interject", {
        sessionId,
        text: blocks
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
        content: blocks,
        ...(requestId ? { interjectionId: requestId } : {}),
      });
      return "accepted";
    } catch (error) {
      return error instanceof RequestError &&
        [-32601, -32602].includes(error.code)
        ? "refused"
        : "uncertain";
    }
  },
});
