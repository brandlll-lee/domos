import { readFileSync } from "node:fs";
import { Type } from "@earendil-works/pi-ai";
export default function (pi) {
  const { url, servers = [] } = JSON.parse(
    readFileSync(process.env.DOMOS_PI_TOOLS, "utf8"),
  );
  pi.registerMcpServer("domos", { url, exposure: "direct", timeout: 600 });
  for (const server of servers)
    pi.registerMcpServer(server.name, { url: server.url, exposure: "direct" });
  pi.on("session_start", () => {
    pi.setActiveTools([...pi.getActiveTools(), "tool_search"]);
  });
  registerPiApprovals(pi);
  registerPiQuestions(pi);
}

export function registerPiApprovals(pi) {
  pi.on("tool_call", async (event, ctx) => {
    if (!["bash", "powershell", "write", "edit"].includes(event.toolName))
      return;
    if (
      !(await ctx.ui.confirm("Computer operation", JSON.stringify(event.input)))
    )
      return { block: true, reason: "Operation was not approved." };
  });
  if (process.platform === "win32")
    pi.on("session_start", () => {
      pi.setActiveTools([
        ...pi.getActiveTools().filter((name) => name !== "bash"),
        "powershell",
      ]);
    });
}

export function registerPiQuestions(pi) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask user",
    description:
      "Ask the user for decisions and wait for their answers. Use native messages for updates and results.",
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String({ minLength: 1 }),
          options: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
        }),
        { minItems: 1, maxItems: 6 },
      ),
    }),
    async execute(_id, params, signal, _update, ctx) {
      if (!ctx.hasUI)
        throw new Error("User questions require an interactive session.");
      const answers = [];
      for (const item of params.questions) {
        signal?.throwIfAborted();
        const answer = item.options?.length
          ? await ctx.ui.select(item.question, item.options, { signal })
          : await ctx.ui.input(item.question, undefined, { signal });
        if (answer === undefined)
          throw new Error(
            "The user cancelled the question. Do not infer an answer.",
          );
        answers.push({ question: item.question, answer });
      }
      return {
        content: [{ type: "text", text: JSON.stringify(answers) }],
        details: {},
      };
    },
  });
}
