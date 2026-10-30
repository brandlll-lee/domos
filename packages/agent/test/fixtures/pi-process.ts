import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Models } from "@earendil-works/pi-ai/models";
import type {
  RpcCommand,
  RpcExtensionUIResponse,
} from "@earendil-works/pi-coding-agent";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionUIContext,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { nativeHistory } from "../../src/harness/native-history.mjs";
import {
  registerPiApprovals,
  registerPiQuestions,
} from "../../src/harness/pi-tools.mjs";
import type {
  ProcessSpec,
  ProductResult,
  ProductTool,
} from "../../src/harness/types.ts";
import { ProtocolProcess } from "./engine-process.ts";

export class PiProcess extends ProtocolProcess {
  override readonly ready;
  private session?: AgentSession;
  private readonly dialogs = new Map<
    string,
    (response: RpcExtensionUIResponse) => void
  >();
  private readonly lifetime = new AbortController();
  private readonly beforeTool?: (signal: AbortSignal) => Promise<void>;
  private specReady = Promise.resolve();
  private readonly directory: string;
  private readonly models: Models;
  private readonly tools: ProductTool[];
  private readonly invoke: (
    id: string,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<ProductResult>;
  private readonly extra: ToolDefinition[];
  constructor(
    directory: string,
    models: Models,
    tools: ProductTool[],
    invoke: (
      id: string,
      name: string,
      args: Record<string, unknown>,
      signal: AbortSignal,
    ) => Promise<ProductResult>,
    extra: ToolDefinition[] = [],
    beforeTool?: (signal: AbortSignal) => Promise<void>,
  ) {
    super();
    this.directory = directory;
    this.models = models;
    this.tools = tools;
    this.invoke = invoke;
    this.extra = extra;
    this.beforeTool = beforeTool;
    this.ready = Promise.resolve({
      cwd: directory,
      home: directory,
      url: "http://127.0.0.1/mcp/fixture",
    });
    this.receive = (request) => {
      if (request.type === "extension_ui_response") {
        const response = request as unknown as RpcExtensionUIResponse;
        this.dialogs.get(response.id)?.(response);
        this.dialogs.delete(response.id);
        return;
      }
      void this.command(request as RpcCommand).then(
        (data) =>
          this.frame({ type: "response", id: request.id, success: true, data }),
        () =>
          this.frame({
            type: "response",
            id: request.id,
            success: false,
            error: "Fixture command failed",
          }),
      );
    };
    this.checkpoint = async () =>
      this.session?.sessionManager.getLeafId() ?? "";
    this.history = async (sessionId) =>
      nativeHistory({ sessionId, provider: "pi" }, directory);
  }
  override async launch(spec: ProcessSpec) {
    this.spec = spec;
    if (spec.args.includes("--version")) {
      this.output.write("pi 1.4.0\n");
      this.ended.resolve({ code: 0 });
      return;
    }
    this.specReady = mkdir(this.directory, { recursive: true }).then(() => {});
    await this.specReady;
    await this.command({ type: "new_session" });
  }
  private async command(request: RpcCommand): Promise<unknown> {
    await this.specReady;
    if (request.type === "new_session" || request.type === "switch_session") {
      await this.session?.dispose();
      const modelRuntime = await ModelRuntime.create({
        authPath: join(this.directory, "auth.json"),
        modelsPath: null,
        modelsStorePath: join(this.directory, "models-cache.json"),
        refreshOnCreate: false,
      });
      for (const provider of this.models.getProviders())
        modelRuntime.registerNativeProvider(provider);
      await modelRuntime.refresh();
      const settingsManager = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: true, maxRetries: 1, baseDelayMs: 10 },
      });
      const resourceLoader = new DefaultResourceLoader({
        cwd: this.directory,
        agentDir: this.directory,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noContextFiles: true,
        extensionFactories: [
          registerPiApprovals,
          registerPiQuestions,
          (pi) => {
            pi.on("tool_call", (event) =>
              ["read", "write", "edit", "bash", "powershell"].includes(
                event.toolName,
              )
                ? this.beforeTool?.(this.lifetime.signal)
                : undefined,
            );
          },
        ],
        systemPrompt: this.spec?.instructions ?? "Test assistant.",
      });
      await resourceLoader.reload();
      const customTools: ToolDefinition[] = this.tools.map((tool) => ({
        name: tool.name,
        label: tool.name,
        description: tool.description,
        parameters: tool.inputSchema as ToolDefinition["parameters"],
        execute: async (id, args, signal) => {
          const result = await this.invoke(
            id,
            tool.name,
            args as Record<string, unknown>,
            signal ?? new AbortController().signal,
          );
          return {
            content: result.content.filter(
              (item) => item.type === "text" || item.type === "image",
            ),
            details: result,
          };
        },
      }));
      this.session = (
        await createAgentSession({
          cwd: this.directory,
          agentDir: this.directory,
          modelRuntime,
          model: (await this.models.getAvailable())[0],
          settingsManager,
          resourceLoader,
          customTools: [...customTools, ...this.extra],
          sessionManager:
            request.type === "switch_session"
              ? SessionManager.open(
                  request.sessionPath,
                  join(this.directory, "pi", "sessions"),
                  this.directory,
                )
              : SessionManager.create(
                  this.directory,
                  join(this.directory, "pi", "sessions"),
                ),
        })
      ).session;
      await this.session.bindExtensions({
        mode: "rpc",
        uiContext: new Proxy(
          {
            select: (title: string, options: string[]) => {
              const id = crypto.randomUUID();
              const reply = Promise.withResolvers<string | undefined>();
              this.dialogs.set(id, (response) =>
                reply.resolve("value" in response ? response.value : undefined),
              );
              this.frame({
                type: "extension_ui_request",
                method: "select",
                id,
                title,
                options,
              });
              return reply.promise;
            },
            input: (title: string) => {
              const id = crypto.randomUUID();
              const reply = Promise.withResolvers<string | undefined>();
              this.dialogs.set(id, (response) =>
                reply.resolve("value" in response ? response.value : undefined),
              );
              this.frame({
                type: "extension_ui_request",
                method: "input",
                id,
                title,
              });
              return reply.promise;
            },
            confirm: (title: string, message: string) => {
              const id = crypto.randomUUID();
              const reply = Promise.withResolvers<boolean>();
              this.dialogs.set(id, (response) =>
                reply.resolve("confirmed" in response && response.confirmed),
              );
              this.frame({
                type: "extension_ui_request",
                method: "confirm",
                id,
                title,
                message,
              });
              return reply.promise;
            },
          },
          { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
        ) as ExtensionUIContext,
      });
      this.session.subscribe((event) => this.frame(event));
      return {};
    }
    const session = this.session;
    if (!session) throw new Error("Session required");
    switch (request.type) {
      case "get_state":
        return {
          sessionFile: session.sessionManager.getSessionFile(),
          model: session.model,
          thinkingLevel: session.thinkingLevel,
          autoCompactionEnabled: false,
        };
      case "get_available_models":
        return { models: await this.models.getAvailable() };
      case "get_available_thinking_levels":
        return { levels: session.getAvailableThinkingLevels() };
      case "get_commands":
        return { commands: [] };
      case "get_session_stats":
        return session.getSessionStats();
      case "set_model": {
        const model = this.models.getModel(request.provider, request.modelId);
        if (!model) throw new Error("Model required");
        await session.setModel(model);
        return {};
      }
      case "set_thinking_level":
        session.setThinkingLevel(request.level);
        return {};
      case "set_steering_mode":
        session.setSteeringMode(request.mode);
        return {};
      case "prompt":
        void session
          .prompt(request.message, { images: request.images })
          .catch(() => this.frame({ type: "agent_settled" }));
        return { disposition: "started" };
      case "steer":
        await session.steer(request.message, request.images);
        return {};
      case "abort":
        this.lifetime.abort();
        for (const answer of this.dialogs.values())
          answer({ type: "extension_ui_response", id: "", cancelled: true });
        this.dialogs.clear();
        await session.abort();
        return {};
      default:
        return {};
    }
  }
  override async close() {
    this.lifetime.abort();
    for (const answer of this.dialogs.values())
      answer({ type: "extension_ui_response", id: "", cancelled: true });
    this.dialogs.clear();
    await this.session?.abort();
    await this.session?.dispose();
    await super.close();
  }
}
