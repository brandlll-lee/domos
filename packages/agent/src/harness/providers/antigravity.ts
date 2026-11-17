import { acpProvider } from "./acp.ts";

export const antigravityProvider = acpProvider({
  id: "antigravity",
  name: "Antigravity",
  command: "agy",
  package: "",
  login: ["acp", "--login"],
  args: () => ["acp"],
  mode: (config) =>
    config.approvalMode === "full" || config.approvalMode === "edits"
      ? "accept-edits"
      : config.approvalMode === "auto"
        ? "auto"
        : "default",
  promptSteering: (hello) => {
    const version = hello.agentInfo?.version?.match(/^(\d+)\.(\d+)\.(\d+)/);
    return version &&
      (Number(version[1]) > 1 ||
        (Number(version[1]) === 1 && Number(version[2]) >= 5))
      ? "replace"
      : undefined;
  },
});
