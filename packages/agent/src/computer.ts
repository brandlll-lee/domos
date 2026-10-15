import { arch, platform, release } from "node:os";
import { defineExtension, section } from "@earendil-works/pi-durable";
import {
  createBashTool,
  createPowerShellTool,
} from "@earendil-works/pi-durable/tools";
import type { Computer } from "./computer/index.ts";

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
