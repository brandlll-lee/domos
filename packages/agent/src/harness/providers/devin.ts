import { readNativeConfiguredMcp } from "../mcp-catalog.ts";
import { acpProvider } from "./acp.ts";

export const devinProvider = acpProvider({
  id: "devin",
  name: "Devin",
  command: "devin",
  package: "",
  login: ["auth", "login"],
  args: () => ["acp"],
  mcp: readNativeConfiguredMcp,
  mode: (config) =>
    config.approvalMode === "full"
      ? "bypass"
      : config.approvalMode === "auto"
        ? "smart"
        : "accept-edits",
  promptSteering: (hello) =>
    hello.agentCapabilities?._meta?.["cognition.ai/midTurnPrompts"] === true
      ? "append"
      : undefined,
});
