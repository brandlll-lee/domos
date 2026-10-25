import { mkdtemp, rm } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { openChat } from "@domos/agent/chat";
import { parseConfig } from "@domos/agent/config";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { expect, onTestFinished, test } from "vitest";
import { createApp } from "../src/app.ts";
import type { AppRouter } from "../src/router.ts";

test.runIf(platform() === "win32")(
  "computer services require authorization and retain the enabled tools after restart",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "domos-services-api-"));
    const config = parseConfig(
      { dataDir: directory },
      join(directory, "config.json"),
    );
    let runtime = await openChat(context, config, { models: createModels() });
    const client = () => {
      const app = createApp(
        runtime.bots,
        createModels(),
        runtime.files,
        runtime.work,
        runtime.computer,
        undefined,
        runtime.engines,
      );
      return createORPCClient<RouterClient<AppRouter>>(
        new RPCLink({
          url: "http://localhost/rpc",
          fetch: async (request, init) => app.fetch(new Request(request, init)),
        }),
      );
    };
    onTestFinished(async () => {
      await runtime.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    });
    const botId = runtime.conversation.id;
    await expect(
      client().computer.service({ botId, service: "desktop", enabled: true }),
    ).rejects.toThrow();
    const binding = await runtime.computer.preparation.configure(
      { botId, mode: "process", revision: 0, requestId: crypto.randomUUID() },
      context,
    );
    expect(binding.approvalMode ?? "ask").toBe("ask");
    const approval = {
      botId,
      computerId: binding.computerId as string,
      revision: binding.revision,
      mode: "auto" as const,
    };
    await expect(
      client().computer.approval({ ...approval, computerId: "other" }),
    ).rejects.toThrow("工作电脑已改变");
    await expect(
      client().computer.approval({ ...approval, mode: "invalid" as "auto" }),
    ).rejects.toThrow();
    await client().computer.approval(approval);
    await client().computer.approval(approval);
    expect(
      await client().computer.service({
        botId,
        service: "desktop",
        enabled: true,
      }),
    ).toMatchObject({
      desktop: { enabled: true, available: true, error: null },
    });
    expect(
      (await runtime.computer.tools.catalog(botId, context)).some(
        (tool) => tool.name === "desktop_get_desktop_state",
      ),
    ).toBe(true);
    const controller = new AbortController();
    const stream = await client().computer.watch(
      { botId, service: "desktop" },
      { signal: controller.signal },
    );
    const ready = (await stream.next()).value;
    expect(ready).toMatchObject({ type: "ready" });
    if (ready?.type !== "ready") throw new Error("View required");
    await expect(
      client().computer.input({
        botId,
        view: ready.id,
        action: { type: "text", text: "Test" },
      }),
    ).rejects.toThrow("接管");
    expect(
      await client().computer.input({
        botId,
        view: ready.id,
        action: { type: "take" },
      }),
    ).toEqual({ controlling: true });
    const frame = (await stream.next()).value;
    expect(frame).toMatchObject({
      type: "frame",
      frame: { mimeType: "image/png" },
    });
    controller.abort();
    await stream.return?.();
    await expect
      .poll(
        async () => {
          const lease = await runtime.computer.tools.takeover(
            botId,
            "desktop",
            context,
          );
          await runtime.computer.tools.release(
            botId,
            "desktop",
            lease,
            context,
          );
          return true;
        },
        { timeout: 5000 },
      )
      .toBe(true);
    await runtime.close();
    runtime = await openChat(context, config, { models: createModels() });
    expect((await client().computer.get({ botId })).approvalMode).toBe("auto");
    expect((await client().computer.services({ botId })).desktop.enabled).toBe(
      true,
    );
    await client().computer.service({
      botId,
      service: "desktop",
      enabled: false,
    });
    expect(await runtime.computer.tools.catalog(botId, context)).toEqual([]);
    let revision = approval.revision;
    for (const computerId of [null, approval.computerId]) {
      await client().computer.assign({
        botId,
        computerId,
        revision: revision++,
        requestId: crypto.randomUUID(),
      });
      await expect(client().computer.approval(approval)).rejects.toThrow();
    }
    expect((await client().computer.get({ botId })).approvalMode ?? "ask").toBe(
      "ask",
    );
    await client().computer.approval({ ...approval, revision });
    await client().computer.authorize({
      id: approval.computerId,
      authorized: false,
    });
    await expect(
      client().computer.approval({ ...approval, revision: revision + 1 }),
    ).rejects.toThrow("请先授权");
    await client().computer.authorize({
      id: approval.computerId,
      authorized: true,
    });
    await expect(
      client().computer.approval({ ...approval, revision }),
    ).rejects.toThrow();
    expect((await client().computer.get({ botId })).approvalMode ?? "ask").toBe(
      "ask",
    );
  },
);
