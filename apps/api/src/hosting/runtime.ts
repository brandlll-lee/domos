import { openChat } from "@domos/agent/chat";
import { loadConfig } from "@domos/agent/config";
import { acquireDataLease } from "@domos/agent/lease";
import { persistentCredentials } from "@domos/hosting/credentials";
import { Sessions } from "@domos/hosting/sessions";
import { HostingStore } from "@domos/hosting/store";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createApp } from "../app.ts";
import { hostingApp } from "./routes.ts";

export async function openHostedRuntime() {
  const config = await loadConfig();
  const release = await acquireDataLease(config.dataDir);
  let store: HostingStore | undefined;
  let runtime: Awaited<ReturnType<typeof openChat>> | undefined;
  try {
    store = await HostingStore.open(config.dataDir);
    const sessions = new Sessions(store);
    await sessions.bootstrap(config.dataDir);
    const models = builtinModels({ credentials: persistentCredentials(store) });
    let app: ReturnType<typeof createApp> | undefined;
    let pending: Promise<void> | undefined;
    const start = (model: NonNullable<typeof config.model>) => {
      if (runtime) return Promise.resolve();
      if (pending) return pending;
      pending = (async () => {
        runtime = await openChat(
          BACKGROUND_CONTEXT,
          { ...config, model },
          { models, lease: false },
        );
        app = createApp(
          runtime.bots,
          models,
          runtime.files,
          runtime.work,
          runtime.computer,
          config.staticDir,
        );
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    };
    if (config.model) await start(config.model);
    const hosted = hostingApp({
      config,
      sessions,
      models,
      start,
      forward: async (request) =>
        app
          ? app.fetch(request)
          : Response.json({ error: "请先完成模型配置。" }, { status: 503 }),
    });
    let closed = false;
    return {
      config,
      app: hosted.app,
      async close() {
        if (closed) return;
        closed = true;
        hosted.close();
        await pending?.catch(() => {});
        try {
          await runtime?.close();
        } finally {
          await store?.close();
          await release();
        }
      },
    };
  } catch (error) {
    try {
      await runtime?.close();
    } finally {
      await store?.close();
      await release();
    }
    throw error;
  }
}
