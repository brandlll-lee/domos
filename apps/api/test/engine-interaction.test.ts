import type { Computers } from "@domos/agent/computer/catalog";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, test } from "vitest";
import { runtimeFixture } from "../../../packages/agent/test/fixtures/runtime.ts";
import { createApp } from "../src/app.ts";
import type { AppRouter } from "../src/router.ts";

test("HTTP approval checks Bot ownership and releases the Durable tool", async () => {
  const computers = {
    initialize: async () => {},
    tools: {
      catalog: async () => [
        {
          name: "browser_mutate",
          description: "Mutate",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      finish: () => {},
      invoke: async (...args: Parameters<Computers["tools"]["invoke"]>) => ({
        content: [
          {
            type: "text",
            text: (await args[6]?.({ name: "mutate", args: {} }, args[4]))
              ? "Delivered"
              : "Rejected",
          },
        ],
      }),
    },
  } as unknown as Computers;
  const runtime = await runtimeFixture(computers);
  const app = createApp(
    runtime.bots,
    runtime.models,
    runtime.files,
    runtime.work,
    undefined,
    undefined,
    runtime.engines,
  );
  const api = createORPCClient<RouterClient<AppRouter>>(
    new RPCLink({
      url: "http://domos/rpc",
      fetch: async (request, init) => app.fetch(new Request(request, init)),
    }),
  );
  const botId = runtime.conversation.id;
  runtime.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("browser_mutate", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Done"),
  ]);
  const response = await api.send({
    botId,
    text: "Work",
    requestId: crypto.randomUUID(),
  });
  await expect
    .poll(async () => (await api.get({ botId })).approvals?.length)
    .toBe(1);
  const approval = (await api.get({ botId })).approvals?.[0];
  if (!approval) throw new Error("Approval required");
  await expect(
    api.engines.answer({ botId: 999999, id: approval.id, allow: true }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await api.engines.answer({ botId, id: approval.id, allow: false });
  await runtime.harness.submission(response.id, context).then((item) => {
    if (!item) throw new Error("Submission required");
    return item.wait(context);
  });
  expect((await api.get({ botId })).approvals).toEqual([]);
  expect(JSON.stringify((await api.get({ botId })).messages)).toContain(
    "Rejected",
  );
});
