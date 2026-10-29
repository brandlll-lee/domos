import { readFileSync } from "node:fs";
export default function (pi) {
  const { url } = JSON.parse(readFileSync(process.env.DOMOS_PI_TOOLS, "utf8"));
  pi.registerMcpServer("domos", { url, exposure: "direct", timeout: 600 });
  registerPiApprovals(pi);
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
