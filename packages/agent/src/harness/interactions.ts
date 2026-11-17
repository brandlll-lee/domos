import type { Context } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { type Attachment, MAX_ATTACHMENTS } from "../attachments.ts";
import { owningBot } from "../conversations.ts";
import { linkUrl } from "../link-previews.ts";
import { toolResult } from "../work/state.ts";
import type { EngineExecution } from "./execution.ts";
import type { EngineApproval } from "./types.ts";

const id = () => Type.String({ minLength: 1, maxLength: 256 });
const attachments = () =>
  Type.Optional(
    Type.Array(id(), { maxItems: MAX_ATTACHMENTS, uniqueItems: true }),
  );

const questionParameters = Type.Object({
  title: id(),
  body: Type.Optional(Type.String({ maxLength: 16000 })),
  footer: Type.Optional(Type.String({ maxLength: 2000 })),
  attachments: attachments(),
  questions: Type.Array(
    Type.Object({
      id: id(),
      title: id(),
      options: Type.Optional(
        Type.Array(
          Type.Object({
            id: id(),
            label: id(),
            description: Type.Optional(Type.String({ maxLength: 2000 })),
            attachments: attachments(),
            actions: Type.Optional(
              Type.Array(Type.Object({ id: id(), label: id() }), {
                minItems: 1,
                maxItems: 3,
              }),
            ),
          }),
          { minItems: 1, maxItems: 20 },
        ),
      ),
      multiple: Type.Optional(Type.Boolean()),
      allowOther: Type.Optional(Type.Boolean()),
      required: Type.Optional(Type.Boolean()),
    }),
    { minItems: 1, maxItems: 1 },
  ),
});

export function interactionExtension(execution: EngineExecution) {
  return {
    name: "domos-interactions",
    tools: [
      defineTool({
        name: "review_draft",
        description:
          "Show an action draft for the user to review, edit or cancel. Supply the actual action label and relevant fields. The response contains the current confirmed version, not proof that the action ran. Execute that version with the native tool only after confirmation. Do not collect credentials here.",
        parameters: Type.Object({
          title: Type.String({ minLength: 1, maxLength: 256 }),
          confirmLabel: Type.String({ minLength: 1, maxLength: 64 }),
          body: Type.Optional(Type.String({ maxLength: 16000 })),
          editable: Type.Optional(Type.Boolean()),
          fields: Type.Optional(
            Type.Array(
              Type.Object({
                id: Type.String({
                  minLength: 1,
                  maxLength: 256,
                  pattern: "^.+$",
                  description:
                    "Field identifier. body is reserved for draft text.",
                }),
                label: Type.String({ minLength: 1, maxLength: 256 }),
                value: Type.String({ maxLength: 16000 }),
                editable: Type.Optional(Type.Boolean()),
                multiline: Type.Optional(Type.Boolean()),
              }),
              { maxItems: 20 },
            ),
          ),
        }),
        replay: "safe",
        executionMode: "sequential",
        async execute(input, api, context) {
          if (input.fields?.some((field) => field.id === "body"))
            throw new Error("字段标识 body 为草稿正文保留。");
          if (
            new Set(input.fields?.map((field) => field.id)).size !==
            (input.fields?.length ?? 0)
          )
            throw new Error("字段标识重复。");
          const answer = await execution.computer.approve(
            api.conversationId,
            {
              id: `draft:${api.callId}`,
              title: input.title,
              detail: "",
              kind: "question",
              confirmLabel: input.confirmLabel,
              draft: {
                body: input.body,
                editable: input.editable,
                fields: input.fields,
              },
            },
            context.abortSignal ?? new AbortController().signal,
            context,
          );
          if (!answer.allow) return toolResult({ status: "cancelled" });
          return toolResult({
            status: "confirmed",
            fields: Object.fromEntries(
              (input.fields ?? []).map((field) => [
                field.id,
                field.editable
                  ? (answer.answers?.[field.id]?.[0] ?? field.value)
                  : field.value,
              ]),
            ),
            ...(input.body !== undefined
              ? {
                  body: input.editable
                    ? (answer.answers?.body?.[0] ?? input.body)
                    : input.body,
                }
              : {}),
          });
        },
      }),
      defineTool({
        name: "request_credentials",
        description:
          "Ask the user to configure an existing authorized MCP connection securely. Omit connectionId to list this Bot's connections. Prefer oauth for services with browser authorization. For secret mode, fields name HTTP headers or stdio environment variables; prefix is non-secret syntax such as 'Bearer '. Never supply or request secret values in chat. Only configuration status returns to you. Use mcp_call tools/list to discover the configured service, then mcp_call tools/call. Do not claim task completion from configuration alone.",
        parameters: Type.Object({
          connectionId: Type.Optional(Type.String({ format: "uuid" })),
          mode: Type.Optional(
            Type.Union([Type.Literal("oauth"), Type.Literal("secret")]),
          ),
          reason: Type.Optional(Type.String({ maxLength: 2000 })),
          fields: Type.Optional(
            Type.Array(
              Type.Object({
                name: Type.String({ minLength: 1, maxLength: 256 }),
                label: Type.String({ minLength: 1, maxLength: 256 }),
                prefix: Type.Optional(Type.String({ maxLength: 256 })),
              }),
              { maxItems: 20 },
            ),
          ),
        }),
        replay: "safe",
        executionMode: "sequential",
        async execute(input, api, context) {
          const service = execution.mcp;
          if (!service) throw new Error("连接服务不可用。");
          const connections = (await service.list(context)).filter(
            (item) =>
              item.enabled &&
              item.grants.some((grant) => grant.botId === api.conversationId),
          );
          if (!input.connectionId)
            return toolResult({
              connections: connections.map(
                ({ id, name, status, transport }) => ({
                  id,
                  name,
                  status,
                  transport,
                }),
              ),
            });
          const connection = connections.find(
            (item) => item.id === input.connectionId,
          );
          if (!connection) throw new Error("连接不可用或未授权。");
          const mode = input.mode ?? "oauth";
          const fields = input.fields ?? [];
          if (
            mode === "secret" &&
            (!fields.length ||
              new Set(fields.map((field) => field.name)).size !== fields.length)
          )
            throw new Error("请提供不同的凭证字段。");
          if (mode === "oauth" && connection.transport !== "http")
            throw new Error("此连接不能使用浏览器授权。");
          const answer = await execution.computer.approve(
            api.conversationId,
            {
              id: `credential:${api.callId}`,
              title: `连接 ${connection.name}`,
              detail: input.reason ?? "",
              kind: "question",
              credential: {
                connectionId: connection.id,
                revision: connection.revision,
                mode,
                fields: mode === "secret" ? fields : [],
              },
            },
            context.abortSignal ?? new AbortController().signal,
            context,
          );
          return toolResult({
            connectionId: connection.id,
            status: answer.allow ? "configured" : "cancelled",
          });
        },
      }),
      defineTool({
        name: "ask_question",
        description:
          "Send exactly one persistent question. Return after sending; the user may answer later as a referenced chat message. Sent does not mean answered. Do not infer an answer. Use this shared question card for text or media comparisons. Attachments are saved file IDs from attach_file or user uploads, never URLs or inline data. Each option can have attachments and up to three reply actions with unique IDs. Without actions, selecting an option returns its ID. With actions, it returns the action ID. Media preview never selects an answer. Use multiple for multiple answers and allowOther for a custom answer. The answer expresses user intent, not permission to execute an operation. Use native messages for updates and results.",
        parameters: questionParameters,
        replay: "safe",
        executionMode: "sequential",
        async execute(input, api, context) {
          if (input.questions.length !== 1)
            throw new Error("每次只能发送一个问题。");
          if (
            new Set(input.questions.map((question) => question.id)).size !==
            input.questions.length
          )
            throw new Error("问题标识重复。");
          for (const question of input.questions) {
            const ids = (question.options ?? []).flatMap((option) => [
              option.id,
              ...(option.actions ?? []).map((action) => action.id),
            ]);
            if (new Set(ids).size !== ids.length)
              throw new Error("选项或操作标识重复。");
          }
          const ids = [
            ...new Set([
              ...(input.attachments ?? []),
              ...input.questions.flatMap((question) =>
                (question.options ?? []).flatMap(
                  (option) => option.attachments ?? [],
                ),
              ),
            ]),
          ];
          if (ids.length > MAX_ATTACHMENTS)
            throw new Error(`最多添加 ${MAX_ATTACHMENTS} 个文件。`);
          const saved = new Map<string, Attachment>();
          if (ids.length) {
            if (!execution.files) throw new Error("文件服务不可用。");
            const botId = await owningBot(api, api.conversationId, context);
            for (const id of ids) {
              context.abortSignal?.throwIfAborted();
              saved.set(id, await execution.files.metadata(botId, id));
            }
            await execution.files.verify(botId, [...saved.values()], context);
          }
          const files = (ids?: string[]) =>
            ids?.map((id) => saved.get(id) as Attachment);
          const request: EngineApproval = {
            id: `question:${api.taskId}:${api.callId}`,
            kind: "question",
            title: input.title,
            detail: input.body ?? "",
            footer: input.footer,
            attachments: files(input.attachments),
            questions: input.questions.map((question) => ({
              ...question,
              options: question.options?.map((option) => ({
                ...option,
                attachments: files(option.attachments),
              })),
            })),
          };
          const published = await execution.computer.publishQuestion(
            api.conversationId,
            request,
            context,
          );
          return toolResult({
            status: published.answer
              ? published.answer.allow
                ? "answered"
                : "cancelled"
              : "sent",
            questionId: published.request.id,
            ...(published.answer?.answers
              ? { answers: published.answer.answers }
              : {}),
          });
        },
      }),
      defineTool({
        name: "send_link_card",
        description:
          "Send a standalone link card to the user. Supply an HTTPS URL, your own button label and body, and optional title and footer. Domos reads the website preview separately. This sends a message immediately; it does not wait for an answer or open the page. Only the user's click opens the link. Use it for a clear next step on a website. Do not repeat the card as a text message.",
        parameters: Type.Object({
          url: Type.String({ minLength: 1, maxLength: 4096 }),
          label: Type.String({ minLength: 1, maxLength: 64 }),
          body: Type.String({ minLength: 1, maxLength: 16000 }),
          title: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
          footer: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
        }),
        replay: "safe",
        executionMode: "sequential",
        async execute(input) {
          linkUrl(input.url);
          if (![input.label, input.body].every((value) => value.trim()))
            throw new Error("请提供按钮文案和正文。");
          return {
            output: [{ type: "text" as const, text: "Link card sent." }],
            details: { link: input },
          };
        },
      }),
    ] as const,
  };
}

export async function completeCredentials(
  execution: EngineExecution,
  botId: number,
  id: string,
  values: Record<string, string>,
  context: Context,
) {
  await execution.computer.answer(
    botId,
    id,
    { allow: true },
    context,
    async (request) => {
      const credential = request.credential;
      if (!credential || !execution.mcp) throw new Error("凭证请求已失效。");
      await execution.mcp.configureCredential(
        botId,
        credential,
        values,
        context,
      );
    },
  );
}
