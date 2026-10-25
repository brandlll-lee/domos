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
          return `Tools execute on ${status.name} (${status.id}). OS: ${status.os ?? "not connected"} ${status.arch ?? ""}. Working directory: ${env?.cwd ?? "unavailable"}. Enabled tools: ${agent.tools.map((tool) => tool.name).join(", ")}. State: ${status.state}. Authorized: ${status.authorized}. Permission boundary: ${status.boundary}. Network: ${status.network}. Use only the listed tools. Prefer browser DOM/CDP for web pages. For desktop apps, observe accessible controls first; prefer set_value for text fields, and screenshot coordinates when controls are unreliable. For numeric batch targets, pass both pid and window_id. Use app/window names or a newly confirmed identity when a dialog opens. Batch known consecutive actions with desktop_run_steps and observe:{}; include_screenshot:true adds visual evidence. wait_for and expect are step fields, not tool names. To wait for known UI state, use a check-only step such as {wait_for:{text:"Ready",timeout_ms:5000}}, or desktop_verify_state with exact window and predicates. Do not use shell sleeps for UI loading. Stop at an unknown target or dialog and observe it. A failed batch may have executed earlier steps; inspect results and never replay it. Re-read the same tree scope with since:"latest"; use include_accessibility_tree:false for pixels alone. A delivered action is not verified success. Read the domos outcome, check each UI mode transition with expect before dependent input, submit editing before saving, verify the saved result, and inspect unconfirmed input before more actions. Recover failed observation with a read, never another input. Bots share OS permissions and files. Never switch computers or repeat an action with an unknown outcome.`;
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
