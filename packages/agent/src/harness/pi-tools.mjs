export default function (pi) {
  if (process.env.DOMOS_PI_MCP_URL)
    pi.registerMcpServer("domos", {
      url: process.env.DOMOS_PI_MCP_URL,
      exposure: "direct",
    });
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
  pi.on("message_end", ({ message }) => {
    if (message.role !== "toolResult" || !message.isError) return;
    const tools = pi.getActiveTools();
    if (tools.includes(message.toolName)) return;
    return {
      message: {
        ...message,
        content: [
          {
            type: "text",
            text: `The requested tool is not active. Nothing was executed. Currently active tools: ${tools.join(", ")}. Select an active tool by its exact name.`,
          },
        ],
      },
    };
  });
}
