import { arch, platform, release } from "node:os";
import { defineExtension, section } from "@earendil-works/pi-durable";
import {
  createBashTool,
  createPowerShellTool,
} from "@earendil-works/pi-durable/tools";

export const computer = defineExtension({
  name: "domos-computer",
  tools: [platform() === "win32" ? createPowerShellTool() : createBashTool()],
  sections: [
    section(
      "computer",
      ({ env, agent }) =>
        `Tools execute on the local computer running Domos. The model service location does not determine tool access. OS: ${platform()} ${release()} ${arch()}. Working directory: ${env?.cwd}. Available tools: ${agent.tools.map((tool) => tool.name).join(", ")}. Commands run with the Domos process user's host access; the working directory is not a sandbox. File tools and published attachments use this Bot's workspace. Use tool results to verify computer facts.`,
    ),
  ],
});
