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
    await runtime.computer.preparation.configure(
      { botId, mode: "process", revision: 0, requestId: crypto.randomUUID() },
      context,
    );
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
    await runtime.close();
    runtime = await openChat(context, config, { models: createModels() });
    expect((await client().computer.services({ botId })).desktop.enabled).toBe(
      true,
    );
    await client().computer.service({
      botId,
      service: "desktop",
      enabled: false,
    });
    expect(await runtime.computer.tools.catalog(botId, context)).toEqual([]);
  },
);
