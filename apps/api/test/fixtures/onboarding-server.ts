import { createServer } from "node:http";
import { dirname } from "node:path";
import { openChat } from "@domos/agent/chat";
import { parseConfig } from "@domos/agent/config";
import { Sessions } from "@domos/hosting/sessions";
import { HostingStore } from "@domos/hosting/store";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "../../src/app.ts";
import { hostingApp } from "../../src/hosting/routes.ts";

const directory = process.argv[2];
if (!directory) throw new Error("Directory required");
const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
const response = () => {
  faux.appendResponses([response]);
  return fauxAssistantMessage("模型已回复。");
};
faux.setResponses([response]);
const config = parseConfig(
  { dataDir: directory },
  `${dirname(directory)}/config.json`,
);
const runtime = await openChat(BACKGROUND_CONTEXT, config, { models });
const store = await HostingStore.open(directory);
const sessions = new Sessions(store);
const api = createApp(
  runtime.bots,
  models,
  runtime.files,
  runtime.work,
  runtime.computer,
);
let hosted: ReturnType<typeof hostingApp>;
const server = createServer((request, response) =>
  getRequestListener(hosted.app.fetch)(request, response),
);
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Port required");
  config.port = address.port;
  hosted = hostingApp({
    config,
    sessions,
    models,
    forward: async (request) => api.fetch(request),
  });
  process.send?.({ port: address.port, code: sessions.pairing("admin").code });
});
process.on("disconnect", () => {
  server.close();
  server.closeAllConnections();
  hosted.close();
  void runtime.close().then(() => store.close());
});
