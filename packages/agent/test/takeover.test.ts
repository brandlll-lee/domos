import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { expect, test, vi } from "vitest";
import type { Computers } from "../src/computer/catalog.ts";
import { ComputerRequests } from "../src/computer/runtime.ts";
import { takeoverTool } from "../src/computer/takeover.ts";
import type { ProductResult } from "../src/harness/types.ts";
import { runtimeFixture } from "./fixtures/runtime.ts";

function computerFixture() {
  const binding = { computerId: "bound", revision: 1 };
  const finishRequest = vi.fn(async () => {});
  const takeRequest = vi.fn(async () => ({ control: "user" }));
  const result: ProductResult = {
    content: [{ type: "text", text: "Observed result" }],
    structuredContent: { strict: true },
  };
  const invoke = vi.fn<Computers["tools"]["invoke"]>(
    async (_botId, name, args, _owner, signal, _ctx, approve) => {
      if (!(await approve?.({ name, args }, signal)))
        return { content: [{ type: "text", text: "Rejected" }], isError: true };
      return result;
    },
  );
  const computers = {
    initialize: async () => {},
    attach: async () => {},
    preflight: async () => {},
    binding: async () => binding,
    serviceTarget: async () => ({
      enabled: { browser: true, desktop: true },
      target: {
        services: {
          call: async () => ({
            content: [],
            structuredContent: {
              response: { data: { url: "https://example.com" } },
            },
          }),
        },
      },
    }),
    views: { capture: async () => undefined, takeRequest, finishRequest },
    tools: {
      catalog: async () => [
        takeoverTool,
        {
          name: "desktop_run_steps",
          description: "Mutate bound computer",
          inputSchema: { type: "object", properties: {} },
          outputSchema: {
            type: "object",
            properties: { strict: { type: "boolean" } },
            additionalProperties: false,
          },
        },
      ],
      finish: vi.fn(),
      invoke,
    },
  } as unknown as Computers;
  return { computers, binding, invoke, finishRequest, takeRequest };
}

test.each(["complete", "stop"])(
  "takeover holds its request until %s and retains a final card",
  async (ending) => {
    const fixture = computerFixture();
    const runtime = await runtimeFixture(fixture.computers);
    runtime.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("computer_request_takeover", {
          service: "browser",
          reason: "Please take over",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Continued"),
    ]);
    const id = runtime.conversation.id;
    const submission = await runtime.engines.submit(
      id,
      { text: "Work", requestId: crypto.randomUUID() },
      context,
    );
    const approval = async () =>
      (await runtime.harness.snapshot(ComputerRequests, id, context))
        ?.approvals[0];
    await expect.poll(approval).toMatchObject({
      takeover: { state: "waiting", url: "https://example.com" },
    });
    const request = await approval();
    if (!request) throw new Error("Request required");
    const view = crypto.randomUUID();
    if (ending === "complete") {
      await runtime.engines.takeRequest(id, request.id, view, context);
      expect(fixture.takeRequest).toHaveBeenCalledWith(
        id,
        view,
        request.id,
        "browser",
        "bound",
        context,
      );
      await runtime.engines.answer(id, request.id, { allow: true }, context);
      expect((await submission.wait(context)).status).toBe("done");
      expect(fixture.finishRequest).toHaveBeenCalledOnce();
    } else {
      await runtime.engines.stop(id, context);
      expect((await submission.wait(context)).status).toBe("unanswered");
      expect(fixture.finishRequest).not.toHaveBeenCalled();
    }
    expect(
      (await runtime.engines.view(id, context)).messages.find(
        (message) => message.takeover,
      )?.takeover?.state,
    ).toBe(ending === "complete" ? "done" : "expired");
    expect((await runtime.engines.view(id, context)).approvals).toEqual([]);
    await expect(
      runtime.engines.answer(id, request.id, { allow: true }, context),
    ).rejects.toThrow("失效");
  },
);

test.each([true, false])(
  "shared approval %s preserves native schemas and prevents rejected mutations",
  async (allow) => {
    const fixture = computerFixture();
    const runtime = await runtimeFixture(fixture.computers);
    runtime.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("desktop_run_steps", {}), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Finished"),
    ]);
    const id = runtime.conversation.id;
    const submission = await runtime.engines.submit(
      id,
      { text: "Work", requestId: crypto.randomUUID() },
      context,
    );
    const approvals = async () =>
      (await runtime.engines.view(id, context)).approvals ?? [];
    await expect.poll(approvals).toHaveLength(1);
    const request = (await approvals())[0];
    if (!request) throw new Error("Approval required");
    const other = await runtime.bots.create(
      { name: "Other", requestId: crypto.randomUUID() },
      context,
    );
    await expect(
      runtime.engines.answer(other.id, request.id, { allow }, context),
    ).rejects.toThrow("失效");
    await runtime.engines.answer(id, request.id, { allow }, context);
    expect((await submission.wait(context)).status).toBe("done");
    const result = (await runtime.conversation.context(context)).messages.find(
      (message) => message.role === "toolResult",
    );
    expect(result).toMatchObject({ role: "toolResult", isError: !allow });
    if (result?.role === "toolResult" && allow)
      expect(result.details).toEqual({
        content: [{ type: "text", text: "Observed result" }],
        structuredContent: { strict: true },
      });
    expect(fixture.invoke).toHaveBeenCalledWith(
      id,
      "desktop_run_steps",
      {},
      `computer:${id}`,
      expect.any(AbortSignal),
      expect.anything(),
      expect.any(Function),
    );
  },
);
