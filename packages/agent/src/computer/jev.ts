import { z } from "zod";

export const decisionProvider = z.enum(["typesafe", "openrouter"]);
export type DecisionProvider = z.infer<typeof decisionProvider>;
const providers = {
  typesafe: {
    url: "https://api.typesafe.ai/v1/systemone",
    model: "jev-1.14.0",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/systemone",
    model: "typesafe/jev-1.14",
  },
};
const decisionAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), decisionAnswer),
  usage: z.object({
    input_tokens: z.number().nonnegative(),
    output_tokens: z.number().nonnegative(),
    cost: z.number().nonnegative().optional(),
  }),
});

export async function askJev(
  provider: DecisionProvider,
  key: string,
  state: unknown,
  questions: Record<
    string,
    { type: "choice"; instructions: string; criteria: Record<string, string> }
  >,
  signal: AbortSignal,
) {
  const selected = providers[provider];
  const body = JSON.stringify({
    model: selected.model,
    state,
    questions,
  });
  if (Buffer.byteLength(body) > 4 * 1024 * 1024)
    throw new Error("辅助决策画面过大。请交回主模型。");
  try {
    const response = await fetch(selected.url, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `辅助决策请求失败（${provider}，HTTP ${response.status}）。`,
      );
    }
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (!response.body) throw new Error("辅助决策响应为空。");
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 64 * 1024) throw new Error("辅助决策响应过大。");
      chunks.push(chunk);
    }
    const result = responseSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    for (const [id, question] of Object.entries(questions)) {
      const answer = result.answers[id];
      if (
        !answer ||
        !Object.hasOwn(question.criteria, answer.choice) ||
        !Object.hasOwn(answer.probabilities, answer.choice) ||
        Object.keys(answer.probabilities).some(
          (key) => !Object.hasOwn(question.criteria, key),
        )
      )
        throw new Error("辅助决策候选无效。");
    }
    return result;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.message.startsWith("辅助决策"))
      throw error;
    throw new Error("辅助决策连接超时或响应无效。请交回主模型。");
  }
}
