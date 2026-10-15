import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import type { TaskId } from "@earendil-works/pi-durable";
import { expect, test, vi } from "vitest";
import { chatView } from "../src/chat-view.ts";
import { nextScheduled, validateSchedule } from "../src/work/schedule.ts";
import { context, setup, skillContent } from "./fixtures/work.ts";

test("routine input queues behind active work and a chat stop settles its receipt", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  fixture.faux.setResponses([
    async (_input, options) => {
      entered.resolve();
      options?.signal?.addEventListener("abort", () => release.resolve(), {
        once: true,
      });
      await release.promise;
      return fauxAssistantMessage("Work completed");
    },
  ]);
  try {
    const botId = runtime.conversation.id;
    const routine = await runtime.work.routines.save(
      botId,
      {
        id: crypto.randomUUID(),
        revision: 0,
        title: "Queued",
        instructions: "Make a report",
        schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
        skillIds: [],
        requestId: crypto.randomUUID(),
      },
      context,
    );
    await runtime.conversation.submit(
      { type: "input", content: "Active work" },
      context,
    );
    await entered.promise;
    const taskId = await runtime.work.routines.test(
      botId,
      routine.id,
      crypto.randomUUID(),
      context,
    );
    await vi.waitFor(async () => {
      const run = (await runtime.work.routines.list(botId, context)).runs[0];
      expect(run?.submissionId).not.toBeNull();
      if (!run?.submissionId) throw new Error("Submission not admitted");
      const receipt = await runtime.harness.submission(
        run.submissionId as import("@earendil-works/pi-durable").SubmissionId,
        context,
      );
      expect((await receipt?.status(context))?.status).toBe("queued");
    });
    await runtime.conversation.abort(context);
    await runtime.harness.waitForTask(taskId, context);
    expect(
      (await runtime.work.routines.list(botId, context)).runs[0]?.status,
    ).toBe("stopped");
  } finally {
    release.resolve();
    await runtime.harness.close(context);
  }
});

test("pausing a routine preserves its active delivery and prevents future work", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  fixture.faux.setResponses([
    async () => {
      entered.resolve();
      await release.promise;
      return fauxAssistantMessage("Delivered");
    },
  ]);
  try {
    const botId = runtime.conversation.id;
    const at = fixture.now() + 100;
    const routine = await runtime.work.routines.save(
      botId,
      {
        id: crypto.randomUUID(),
        revision: 0,
        title: "Delivery",
        instructions: "Deliver result",
        schedule: {
          type: "once",
          at: new Date(at).toISOString(),
          timeZone: "UTC",
        },
        skillIds: [],
        requestId: crypto.randomUUID(),
      },
      context,
    );
    await runtime.work.routines.enable(
      botId,
      routine.id,
      true,
      routine.revision,
      crypto.randomUUID(),
      context,
    );
    fixture.advance(at);
    await entered.promise;
    const active = (await runtime.work.routines.list(botId, context)).items[0];
    if (!active?.taskId) throw new Error("Routine task missing");
    await runtime.work.routines.enable(
      botId,
      routine.id,
      false,
      active.revision,
      crypto.randomUUID(),
      context,
    );
    release.resolve();
    await runtime.harness.waitForTask(active.taskId as TaskId, context);
    const state = await runtime.work.routines.list(botId, context);
    expect(state.items[0]?.enabled).toBe(false);
    expect(state.items[0]?.nextAt).toBeNull();
    expect(state.runs[0]?.status).toBe("done");
    expect(fixture.faux.state.callCount).toBe(1);
  } finally {
    release.resolve();
    await runtime.harness.close(context);
  }
});
test("reopened routines coalesce missed repeats and deliver a real file once", async () => {
  const fixture = await setup();
  const first = await fixture.open();
  let botId: number;
  let routineId: string;
  try {
    botId = first.conversation.id;
    await first.work.memory.save(
      botId,
      {
        id: crypto.randomUUID(),
        revision: 0,
        text: "Use metric units.",
        shared: false,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    const skill = await first.work.skills.save(
      {
        id: crypto.randomUUID(),
        revision: 0,
        content: skillContent,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    await first.work.skills.enable(
      botId,
      skill.id,
      true,
      skill.revision,
      crypto.randomUUID(),
      context,
    );
    const routine = await first.work.routines.save(
      botId,
      {
        id: crypto.randomUUID(),
        revision: 0,
        title: "Report",
        instructions: "Prepare report.md using saved preferences.",
        schedule: { type: "cron", expression: "0 * * * *", timeZone: "UTC" },
        skillIds: [skill.id],
        requestId: crypto.randomUUID(),
      },
      context,
    );
    routineId = routine.id;
    await first.work.routines.enable(
      botId,
      routine.id,
      true,
      routine.revision,
      crypto.randomUUID(),
      context,
    );
    expect(
      (await first.work.routines.list(botId, context)).items[0]?.nextAt,
    ).toBe(fixture.now() + 3600000);
  } finally {
    await first.harness.close(context);
  }
  fixture.advance(fixture.now() + 5 * 3600000);
  fixture.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("write", {
        path: "report.md",
        content: "# Report\nMetric units.",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("attach_file", { path: "report.md" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Report delivered."),
  ]);
  const second = await fixture.open();
  let attachmentId: string;
  try {
    await vi.waitFor(async () =>
      expect(
        (await second.work.routines.list(botId, context)).runs[0]?.status,
      ).toBe("done"),
    );
    const { items, runs } = await second.work.routines.list(botId, context);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.coalesced).toBe(true);
    expect(runs[0]?.content).toContain("Read the saved report preference");
    expect(items[0]?.nextAt).toBe(fixture.now() + 3600000);
    const view = await second.conversation.viewState(context);
    try {
      const attachment = chatView(view.value).messages.flatMap(
        (message) => message.attachments ?? [],
      )[0];
      if (!attachment) throw new Error("Attachment missing");
      const input = chatView(view.value).messages.find(
        (message) => message.role === "user",
      );
      expect(input?.content).toEqual([
        { type: "text", text: "定时任务：Report", key: expect.any(String) },
      ]);
      attachmentId = attachment.id;
      expect(
        await (await second.files.download(botId, attachmentId)).text(),
      ).toContain("Metric units");
    } finally {
      view.dispose();
    }
    const item = items[0];
    if (!item) throw new Error("Routine missing");
    await second.work.routines.enable(
      botId,
      routineId,
      false,
      item.revision,
      crypto.randomUUID(),
      context,
    );
  } finally {
    await second.harness.close(context);
  }
  const third = await fixture.open();
  try {
    expect((await third.work.routines.list(botId, context)).runs).toHaveLength(
      1,
    );
    expect(
      (await third.work.routines.list(botId, context)).items[0]?.enabled,
    ).toBe(false);
    expect(
      await (await third.files.download(botId, attachmentId)).text(),
    ).toContain("Metric units");
    expect(fixture.faux.state.callCount).toBe(3);
  } finally {
    await third.harness.close(context);
  }
});

test("test runs are idempotent and broken skill bindings produce explicit receipts", async () => {
  const fixture = await setup();
  const runtime = await fixture.open();
  try {
    const botId = runtime.conversation.id;
    const skill = await runtime.work.skills.save(
      {
        id: crypto.randomUUID(),
        revision: 0,
        content: skillContent,
        requestId: crypto.randomUUID(),
      },
      context,
    );
    await runtime.work.skills.enable(
      botId,
      skill.id,
      true,
      1,
      crypto.randomUUID(),
      context,
    );
    const routine = await runtime.work.routines.save(
      botId,
      {
        id: crypto.randomUUID(),
        revision: 0,
        title: "Test",
        instructions: "Use skill",
        schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
        skillIds: [skill.id],
        requestId: crypto.randomUUID(),
      },
      context,
    );
    await runtime.work.skills.delete(skill.id, 2, context);
    const requestId = crypto.randomUUID();
    const taskId = await runtime.work.routines.test(
      botId,
      routine.id,
      requestId,
      context,
    );
    expect(
      await runtime.work.routines.test(botId, routine.id, requestId, context),
    ).toBe(taskId);
    await runtime.harness.waitForTask(taskId, context);
    const { runs } = await runtime.work.routines.list(botId, context);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("技能"),
    });
    expect(fixture.faux.state.callCount).toBe(0);
    await runtime.work.routines.delete(
      botId,
      routine.id,
      routine.revision,
      context,
    );
    expect((await runtime.work.routines.list(botId, context)).items).toEqual(
      [],
    );
  } finally {
    await runtime.harness.close(context);
  }
});

test("calendar validation uses IANA zones and strictly future DST occurrences", () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  expect(() =>
    validateSchedule(
      { type: "once", at: "2026-10-14T00:00:00Z", timeZone: "UTC" },
      now,
    ),
  ).toThrow();
  expect(() =>
    validateSchedule(
      { type: "cron", expression: "0 9 * * *", timeZone: "Unknown/Zone" },
      now,
    ),
  ).toThrow();
  expect(() =>
    validateSchedule(
      { type: "cron", expression: "0 0 31 2 *", timeZone: "UTC" },
      now,
    ),
  ).toThrow();
  expect(() =>
    validateSchedule(
      { type: "once", at: "2027-01-01T09:00", timeZone: "UTC" },
      now,
    ),
  ).toThrow();
  const schedule = {
    type: "cron" as const,
    expression: "30 1 * * *",
    timeZone: "America/New_York",
  };
  const fold = Date.parse("2026-11-01T06:15:00Z");
  expect(nextScheduled(schedule, fold)).toBeGreaterThan(fold);
  expect(
    nextScheduled(
      { type: "cron", expression: "0 9 * * *", timeZone: "Asia/Shanghai" },
      now,
    ),
  ).toBe(Date.parse("2026-10-15T01:00:00Z"));
});
