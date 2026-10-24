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
          return `Tools execute on ${status.name} (${status.id}). OS: ${status.os ?? "not connected"} ${status.arch ?? ""}. Working directory: ${env?.cwd ?? "unavailable"}. Enabled tools: ${agent.tools.map((tool) => tool.name).join(", ")}. State: ${status.state}. Authorized: ${status.authorized}. Permission boundary: ${status.boundary}. Network: ${status.network}. Use only the browser and desktop tools listed for this session. Prefer browser DOM/CDP tools for web pages. For desktop apps, observe the accessibility tree and use element targets first; use screenshot coordinates when no reliable element is available. Use desktop_run_steps when available for known consecutive actions, with observe:{} to act and inspect the result in one call. For screenshot-based actions, use observe:{include_screenshot:true}. Use wait_for/expect for known state changes; stop and observe before choosing an unknown next target. A batch stops at its first failure: inspect its completed steps and any returned dialog before continuing; never replay the whole batch. If focus moves to a dialog, use its returned target or find and observe that dialog instead of retrying the parent window. Re-read trees with since:"latest"; use include_accessibility_tree:false when only pixels are needed. Verify at meaningful checkpoints and before finishing, not after each keystroke; successful delivery alone does not prove success. Bots on the same computer share OS permissions and files. Never fall back to another target or repeat a command with an unknown outcome.`;
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
