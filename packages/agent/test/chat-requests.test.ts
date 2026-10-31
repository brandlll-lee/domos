import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, test } from "vitest";
import { chatView } from "../src/chat-view.ts";
import type { Computers } from "../src/computer/catalog.ts";
import { ComputerRequests, ComputerRuntime } from "../src/computer/runtime.ts";
import type { EngineApproval } from "../src/harness/types.ts";
import { runtimeFixture } from "./fixtures/runtime.ts";

for (const ending of ["answer", "deny", "expire", "restart"] as const) {
  test(`request records survive ${ending} and restore from storage`, async () => {
    const fixture = await runtimeFixture();
    const { harness, conversation } = fixture;
    const boundary = new ComputerRuntime(
      harness,
      fixture.registry,
      {} as Computers,
      fixture.files,
    );
    const request: EngineApproval = {
      id: "question",
      kind: "question",
      title: "Choose",
      detail: "",
      questions: [
        {
          id: "choice",
          title: "Choose",
          options: [{ id: "one", label: "One" }],
          allowOther: true,
        },
      ],
    };
    const result = boundary.approve(
      conversation.id,
      request,
      new AbortController().signal,
      context,
    );
    await expect
      .poll(
        async () =>
          (await harness.snapshot(ComputerRequests, conversation.id, context))
            ?.approvals.length,
      )
      .toBe(1);
    const state = await conversation.viewState(context);
    const pending = chatView(
      state.value,
      (await harness.snapshot(ComputerRequests, conversation.id, context))
        ?.approvals,
    ).messages.find((message) => message.approval);
    state.dispose();
    expect(pending?.approval?.state).toBe("pending");
    expect(pending?.timestamp).toEqual(expect.any(Number));
    if (ending === "restart") {
      const restored = await fixture.reopen();
      const state = await restored.conversation.viewState(context);
      expect(
        chatView(state.value).messages.find((message) => message.approval)
          ?.approval?.state,
      ).toBe("expired");
      state.dispose();
      boundary.expire(conversation.id, request.id);
      await result.catch(() => {});
      return;
    }
    if (ending === "expire") boundary.expire(conversation.id, request.id);
    else
      await boundary.answer(
        conversation.id,
        request.id,
        { allow: ending === "answer", answers: { choice: ["Custom answer"] } },
        context,
      );
    await result;
    const restored = await fixture.reopen();
    const history = await restored.conversation.viewState(context);
    const card = chatView(history.value).messages.find(
      (message) => message.approval,
    );
    history.dispose();
    expect(card?.id).toBe(pending?.id);
    expect(card?.approval?.state).toBe(
      ending === "answer"
        ? "answered"
        : ending === "deny"
          ? "denied"
          : "expired",
    );
    if (ending === "answer")
      expect(card?.approval?.answer?.answers).toEqual({
        choice: ["Custom answer"],
      });
  });
}
