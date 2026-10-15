import { mkdtemp, readFile, rm } from "node:fs/promises";
import { arch, platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { expect, onTestFinished, test } from "vitest";
import { chatView } from "../src/chat-view.ts";
import { computer } from "../src/computer.ts";
import { Files } from "../src/files.ts";
import { messageText } from "../src/messages.ts";
import { openAgent } from "../src/open-agent.ts";
import { chatTranscript } from "../src/transcript.ts";

test.runIf(platform() === "win32")(
  "host commands report hardware, working directory, exit status, and durable errors",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "domos-computer-"));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const database = join(directory, "agent.sqlite");
    const files = new Files(database);
    const registry = createRegistry();
    registry.install(computer);
    registry.install(files.extension());
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const options = {
      models,
      registry,
      env: ({ conversationId }: { conversationId: number }) =>
        files.workspace(conversationId),
    };
    const agent = { model: { provider: "faux", modelId: "faux-1" } };
    const runtime = await openAgent(
      database,
      options,
      agent,
      BACKGROUND_CONTEXT,
    );
    const tool = computer.tools?.[0];
    if (!tool) throw new Error("Computer tool missing");
    const marker = crypto.randomUUID();
    const filename = `${crypto.randomUUID()}.txt`;
    const command = `Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json -Compress; (Get-Location).Path; Set-Content -LiteralPath '${filename}' -Value '${marker}' -NoNewline; exit 17`;
    faux.setResponses([
      async (input) => {
        const prompt = input.messages
          .filter((message) => message.role === "system")
          .flatMap((message) => Object.values(message.sections ?? {}))
          .join("\n");
        expect(prompt).toContain(`${platform()} ${release()} ${arch()}`);
        expect(prompt).toContain(tool.name);
        expect(prompt).toContain(
          (await files.workspace(runtime.conversation.id)).cwd,
        );
        return fauxAssistantMessage([fauxToolCall(tool.name, { command })], {
          stopReason: "toolUse",
        });
      },
      fauxAssistantMessage("Command checked"),
    ]);
    try {
      const submission = await runtime.conversation.submit(
        { type: "input", content: "Inspect this computer" },
        BACKGROUND_CONTEXT,
      );
      await submission.wait(BACKGROUND_CONTEXT);
      const state = await runtime.conversation.viewState(BACKGROUND_CONTEXT);
      try {
        const view = chatView(state.value);
        const result = view.messages.find(
          (message) => message.role === "toolResult",
        );
        expect(result?.toolStatus).toBe("failed");
        expect(result && messageText(result)).toContain('"Name":');
        const workspace = await files.workspace(runtime.conversation.id);
        expect(result && messageText(result)).toContain(workspace.cwd);
        expect(await readFile(join(workspace.cwd, filename), "utf8")).toBe(
          marker,
        );
        expect(
          result?.diagnostics?.some((item) => item.message.includes("17")),
        ).toBe(true);
        const activity = chatTranscript(view).find(
          (item) => item.kind === "activity",
        );
        expect(
          activity?.kind === "activity" &&
            activity.steps.some(
              (step) => step.type === "tool" && step.diagnostics?.length,
            ),
        ).toBe(true);
      } finally {
        state.dispose();
      }
    } finally {
      await runtime.harness.close(BACKGROUND_CONTEXT);
    }
    const restored = await openAgent(
      database,
      options,
      agent,
      BACKGROUND_CONTEXT,
    );
    try {
      const state = await restored.conversation.viewState(BACKGROUND_CONTEXT);
      try {
        expect(
          chatView(state.value)
            .messages.find((message) => message.role === "toolResult")
            ?.diagnostics?.some((item) => item.message.includes("17")),
        ).toBe(true);
      } finally {
        state.dispose();
      }
    } finally {
      await restored.harness.close(BACKGROUND_CONTEXT);
    }
  },
);
