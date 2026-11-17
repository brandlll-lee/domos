import { z } from "zod";
import { readNativeConfiguredMcp } from "../mcp-catalog.ts";
import { acpProvider } from "./acp.ts";

export const cursorProvider = acpProvider({
  id: "cursor",
  name: "Cursor",
  command: "cursor-agent",
  package: "",
  login: ["login"],
  args: () => ["acp"],
  authMethod: "cursor_login",
  mcp: readNativeConfiguredMcp,
  async notification(method, params, emit, plan) {
    if (method === "cursor/update_todos") {
      const update = z
        .object({
          toolCallId: z.string(),
          merge: z.boolean(),
          todos: z
            .array(
              z.object({
                id: z.string(),
                content: z.string(),
                status: z.enum([
                  "pending",
                  "in_progress",
                  "completed",
                  "cancelled",
                ]),
              }),
            )
            .max(1000),
        })
        .parse(params);
      if (!update.merge) plan.clear();
      for (const item of update.todos) {
        if (item.status === "cancelled") plan.delete(item.id);
        else
          plan.set(item.id, {
            step: item.content,
            status: item.status === "in_progress" ? "inProgress" : item.status,
          });
      }
      await emit({
        type: "plan",
        plan: [...plan.values()],
        native: { method, ...update },
      });
      return;
    }
    if (method !== "cursor/task" && method !== "cursor/generate_image") return;
    const item = z
      .object({ toolCallId: z.string(), description: z.string() })
      .parse(params);
    const name = method === "cursor/task" ? "Task" : "Generate image";
    await emit({
      type: "tool",
      id: item.toolCallId,
      name,
      input: params,
      native: { method, ...params },
    });
    if (method === "cursor/task")
      await emit({
        type: "tool_result",
        id: item.toolCallId,
        name,
        text: item.description,
        failed: false,
        native: { method, ...params },
      });
  },
  async question(method, params, ask) {
    if (method === "cursor/create_plan") {
      const plan = z
        .object({ name: z.string().optional(), plan: z.string() })
        .parse(params);
      const answer = await ask({
        id: "",
        kind: "question",
        title: plan.name ?? "确认计划",
        detail: plan.plan,
      });
      return { outcome: { outcome: answer.allow ? "accepted" : "rejected" } };
    }
    if (method !== "cursor/ask_question")
      throw new Error("Cursor 请求了不支持的交互。");
    const request = z
      .object({
        title: z.string().optional(),
        questions: z
          .array(
            z.object({
              id: z.string(),
              prompt: z.string(),
              allowMultiple: z.boolean().optional(),
              options: z.array(z.object({ id: z.string(), label: z.string() })),
            }),
          )
          .min(1)
          .max(20),
      })
      .parse(params);
    const answer = await ask({
      id: "",
      kind: "question",
      title: request.title ?? "需要你的回答",
      detail: "",
      questions: request.questions.map((item) => ({
        id: item.id,
        title: item.prompt,
        multiple: item.allowMultiple,
        options: item.options,
      })),
    });
    return {
      outcome: answer.allow
        ? {
            outcome: "answered",
            answers: request.questions.map((item) => ({
              questionId: item.id,
              selectedOptionIds: answer.answers?.[item.id] ?? [],
            })),
          }
        : { outcome: "cancelled" },
    };
  },
});
