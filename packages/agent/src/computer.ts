import { arch, platform, release } from "node:os";
import { defineExtension, section } from "@earendil-works/pi-durable";
import {
  createBashTool,
  createPowerShellTool,
} from "@earendil-works/pi-durable/tools";
import type { Computers } from "./computer/catalog.ts";
import type { Computer } from "./computer/index.ts";

export const shellTools = [createBashTool(), createPowerShellTool()];

export function computersExtension(target: Computers) {
  return defineExtension({
    name: "domos-computer",
    tools: shellTools,
    sections: [
      section(
        "computer",
        async ({ conversationId, env, agent, read }, context) => {
          const { computer: status } = await target.binding(
            conversationId,
            context,
            read,
          );
          if (!status)
            return "This Bot has no assigned computer. Chat normally. Ask the user to assign a computer before processing workspace files or running commands. Computer tools are disabled.";
          return `Tools execute on ${status.name} (${status.id}). OS: ${status.os ?? "not connected"} ${status.arch ?? ""}. Working directory: ${env?.cwd ?? "unavailable"}. Enabled tools: ${agent.tools.map((tool) => tool.name).join(", ")}. State: ${status.state}. Authorized: ${status.authorized}. Permission boundary: ${status.boundary}. Network: ${status.network}. Use only the browser and desktop tools listed for this session. Bots on the same computer share OS permissions and files. Never fall back to another target or repeat a command with an unknown outcome.`;
        },
      ),
    ],
  });
}

export function computerExtension(target?: Computer) {
  return defineExtension({
    name: "domos-computer",
    tools: [
      (!target || target.config.computer.kind === "process") &&
      platform() === "win32"
        ? createPowerShellTool()
        : createBashTool(),
    ],
    sections: [
      section("computer", async ({ env, agent }) => {
        const status = target
          ? await target.status()
          : {
              boundary: "host",
              os: `${platform()} ${release()}`,
              arch: arch(),
              id: "process",
              network: "host",
            };
        return `Tools execute in target ${status.id}. The model service location does not determine tool access. OS: ${status.os ?? "not connected"} ${status.arch ?? ""}. Working directory: ${env?.cwd}. Available tools: ${agent.tools.map((tool) => tool.name).join(", ")}. Permission boundary: ${status.boundary}. Network: ${status.network}. A process target has the service user's access; an application container shares the service boundary. A sandbox target is a separate work container. Bots on the same computer share OS permissions and files; Bot directories organize work and do not isolate Bots. Never fall back to another target or automatically repeat a command with an unknown outcome. Use tool results to verify computer facts.`;
      }),
    ],
  });
}

export const computer = computerExtension();
