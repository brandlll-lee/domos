import { openChat } from "@domos/agent/chat";
import { loadConfig } from "@domos/agent/config";
import { acquireDataLease } from "@domos/agent/lease";
import { persistentCredentials } from "@domos/hosting/credentials";
import { desktopSession } from "@domos/hosting/desktop";
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
    const credentials = persistentCredentials(store);
    const models = builtinModels({ credentials });
    runtime = await openChat(BACKGROUND_CONTEXT, config, {
      models,
      credentials,
      lease: false,
    });
    const app = createApp(
      runtime.bots,
      models,
      runtime.files,
      runtime.work,
      runtime.computer,
      config.staticDir,
      runtime.engines,
    );
    const hosted = hostingApp({
      config,
      sessions,
      models,
      forward: async (request) => app.fetch(request),
    });
    let closed = false;
    return {
      config,
      app: hosted.app,
      pairDesktop: () => desktopSession(sessions, config.dataDir),
      async close() {
        if (closed) return;
        closed = true;
        hosted.close();
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
