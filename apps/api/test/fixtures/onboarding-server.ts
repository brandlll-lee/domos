import { createServer } from "node:http";
import { dirname } from "node:path";
import { openChat } from "@domos/agent/chat";
import { parseConfig } from "@domos/agent/config";
import { Sessions } from "@domos/hosting/sessions";
import { HostingStore } from "@domos/hosting/store";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { getRequestListener } from "@hono/node-server";
import { ProtocolProcess } from "../../../../packages/agent/test/fixtures/engine-process.ts";
import { createApp } from "../../src/app.ts";
import { hostingApp } from "../../src/hosting/routes.ts";

const directory = process.argv[2];
if (!directory) throw new Error("Directory required");
const faux = fauxProvider({
  models: [
    { id: "faux-1", name: "Faux Model" },
    { id: "faux-2", name: "Faux Model 2" },
  ],
});
const models = createModels();
models.setProvider(faux.provider);
const config = parseConfig(
  { dataDir: directory },
  `${dirname(directory)}/config.json`,
);
const runtime = await openChat(BACKGROUND_CONTEXT, config, { models });
const accountMode = process.argv[3] === "accounts";
let claudeConnected = false;
const connectedProviders = new Set<string>();
runtime.computer.process = async () => {
  const worker = new ProtocolProcess(accountMode ? "cli" : "protocol");
  let authorizing = "";
  if (accountMode) {
    worker.input.on("data", (data) => {
      if (
        worker.spec?.command !== "claude" ||
        !worker.spec.args.includes("login")
      )
        return;
      claudeConnected = data.toString().trim() === "fixture-code";
      worker.ended.resolve({ code: claudeConnected ? 0 : 1 });
    });
    worker.request = async <T>(
      path: string,
      method?: string,
      body?: unknown,
    ) => {
      const input = body as { key?: string; code?: string } | undefined;
      const providers = [
        {
          id: "openai",
          name: "OpenAI",
          models: { one: { id: "one", name: "Fixture OpenCode Model" } },
        },
        {
          id: "other",
          name: "Other",
          models: { two: { id: "two", name: "Other Model" } },
        },
      ];
      const id = path.split("/")[2] ?? "";
      if (path.endsWith("/authorize")) authorizing = id;
      if (path.endsWith("/callback")) {
        if (authorizing !== id || input?.code !== "fixture-code")
          throw new Error("Login failed");
        connectedProviders.add(id);
      }
      if (path.startsWith("/auth/")) {
        if (method === "PUT") connectedProviders.add(id);
        else connectedProviders.delete(id);
      }
      return (
        path === "/provider"
          ? { all: providers, connected: [...connectedProviders] }
          : path === "/provider/auth"
            ? {
                openai: [
                  { type: "oauth", label: "网页登录" },
                  { type: "api", label: "API 密钥" },
                ],
              }
            : path.endsWith("/authorize")
              ? {
                  url: "https://example.com/login",
                  method: "code",
                  instructions: "在浏览器中完成登录。",
                }
              : true
      ) as T;
    };
  }
  const launch = worker.launch.bind(worker);
  worker.launch = async (spec) => {
    worker.spec = spec;
    if (accountMode && spec.command === "claude") {
      if (spec.args.includes("--version")) {
        worker.output.write("claude-cli 2.1.284\n");
        worker.ended.resolve({ code: 0 });
      } else if (spec.args.includes("status")) {
        worker.output.write(JSON.stringify({ loggedIn: claudeConnected }));
        worker.ended.resolve({ code: claudeConnected ? 0 : 1 });
      } else
        worker.output.write(
          "https://claude.com/cai/oauth/authorize?state=fixture\nPaste code here: ",
        );
      return;
    }
    if (accountMode && spec.command === "opencode") return launch(spec);
    if (spec.command === "claude")
      throw Object.assign(new Error("Program not found"), { code: "ENOENT" });
    if (spec.command === "opencode") {
      worker.ended.resolve({ code: 1 });
      return;
    }
    await launch(spec);
  };
  worker.receive = (request) => {
    if (request.type) {
      worker.frame({
        type: "response",
        id: request.id,
        success: true,
        data:
          request.type === "get_state"
            ? { sessionFile: "/work/pi-session" }
            : request.type === "get_available_models"
              ? {
                  models: [
                    { provider: "faux", id: "faux-1", name: "Faux Model" },
                    { provider: "faux", id: "faux-2", name: "Faux Model 2" },
                  ],
                }
              : {},
      });
      if (request.type === "prompt") {
        worker.frame({ type: "message_start", message: { role: "assistant" } });
        worker.frame({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "模型已回复。" },
        });
        worker.frame({ type: "agent_settled" });
      }
    } else if (request.id === "approval") {
      worker.frame({
        method: "item/completed",
        params: {
          item: { id: "answer", type: "agentMessage", text: "Codex 已完成。" },
        },
      });
      worker.frame({
        method: "turn/completed",
        params: { turn: { id: "turn", status: "completed" } },
      });
    } else if (
      request.method === "thread/start" ||
      request.method === "thread/resume"
    )
      worker.response(request, { thread: { id: "codex-session" } });
    else if (request.method === "account/read")
      worker.response(request, { account: { type: "apiKey" } });
    else if (request.method === "model/list")
      worker.response(request, {
        data: [{ id: "test/model", displayName: "Test Model" }],
      });
    else if (request.method === "turn/start") {
      worker.response(request, { turn: { id: "turn" } });
      worker.frame({
        id: "approval",
        method: "item/commandExecution/requestApproval",
        params: { command: "write report.md", cwd: "/work/bots/1" },
      });
    } else if (request.id !== undefined) worker.response(request, {});
  };
  return worker;
};
const store = await HostingStore.open(directory);
const sessions = new Sessions(store);
const api = createApp(
  runtime.bots,
  models,
  runtime.files,
  runtime.work,
  runtime.computer,
  undefined,
  runtime.engines,
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
  process.send?.({
    port: address.port,
    code: sessions.pairing("admin").code,
    clientCode: sessions.pairing("client").code,
  });
});
process.on("disconnect", () => {
  server.close();
  server.closeAllConnections();
  hosted.close();
  void runtime.close().then(() => store.close());
});
