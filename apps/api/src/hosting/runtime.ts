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
    runtime = await openChat(BACKGROUND_CONTEXT, config, {
      models,
      lease: false,
    });
    const app = createApp(
      runtime.bots,
      models,
      runtime.files,
      runtime.work,
      runtime.computer,
      config.staticDir,
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
      async pairDesktop() {
        const result = sessions.exchange(
          sessions.pairing("admin").code,
          "Domos 桌面",
        );
        if (!result) throw new Error("桌面配对未完成。");
        await sessions.removeBootstrap(config.dataDir);
        return { token: result.token, expires: result.device.expires };
      },
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
