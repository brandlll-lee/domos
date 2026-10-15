import { once } from "node:events";
import { appendFile } from "node:fs/promises";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  defineTool,
} from "@earendil-works/pi-durable";
import { openAgent } from "../../src/open-agent.ts";

const [database, callsFile, toolName, requestId, replay, checkpoint] =
  process.argv.slice(2);
if (
  !database ||
  !callsFile ||
  !toolName ||
  !requestId ||
  (replay !== "safe" && replay !== "unsafe") ||
  (checkpoint !== "tool" && checkpoint !== "answer")
) {
  throw new Error("Invalid crash test arguments");
}

function ready() {
  process.send?.({ type: "ready" });
}

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses([
  fauxAssistantMessage(fauxToolCall(toolName, {}), { stopReason: "toolUse" }),
  async (_transcript, options) => {
    ready();
    await once(options?.signal as AbortSignal, "abort");
    return fauxAssistantMessage("Stopped");
  },
]);

const registry = createRegistry();
registry.install(
  defineExtension({
    name: "probe",
    tools: [
      defineTool({
        name: toolName,
        description: "Record a test invocation.",
        parameters: Type.Object({}),
        replay,
        execute: async (_args, _api, context) => {
          await appendFile(callsFile, "called\n");
          if (checkpoint === "tool") {
            ready();
            await once(context.abortSignal as AbortSignal, "abort");
          }
          return { output: [{ type: "text", text: "Recorded" }] };
        },
      }),
    ],
  }),
);

const { harness, conversation } = await openAgent(
  database,
  { models, registry },
  { model: { provider: "faux", modelId: "faux-1" } },
  BACKGROUND_CONTEXT,
);
try {
  const submission = await conversation.submit(
    { type: "input", content: "Run the test operation.", requestId },
    BACKGROUND_CONTEXT,
  );
  await submission.wait(BACKGROUND_CONTEXT);
} finally {
  await harness.close(BACKGROUND_CONTEXT);
}
