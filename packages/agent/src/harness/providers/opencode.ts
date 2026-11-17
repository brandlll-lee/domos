import { acpProvider } from "./acp.ts";

export const opencodeProvider = acpProvider({
  id: "opencode",
  name: "OpenCode",
  command: "opencode",
  package: "opencode-ai@1.19.0",
  login: ["auth", "login"],
});
export const customAcpProvider = acpProvider({
  id: "acp",
  name: "自定义 ACP",
  command: "",
  package: "",
  login: null,
});
