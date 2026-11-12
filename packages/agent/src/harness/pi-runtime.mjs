import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const sdkUrl = pathToFileURL(process.env.DOMOS_PI_SDK);
const sdk = await import(sdkUrl.href);
const { loadMcpConfig } = await import(
  new URL("./extensions/mcp/config.js", sdkUrl).href
);
const { resolveProjectTrusted } = await import(
  new URL("./core/project-trust.js", sdkUrl).href
);
const { createProjectTrustContext } = await import(
  new URL("./cli/project-trust.js", sdkUrl).href
);
const { FileSettingsStorage } = await import(
  new URL("./core/settings-manager.js", sdkUrl).href
);
const { applyHttpProxySettings, configureHttpDispatcher } = await import(
  new URL("./core/http-dispatcher.js", sdkUrl).href
);
process.title = "pi-rpc";
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "pi";
const args = process.argv.slice(2);
const extensions = [];
let sessionDir;
let instructions;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--session-dir") sessionDir = args[++i];
  else if (args[i] === "--append-system-prompt")
    instructions = await readFile(args[++i], "utf8");
  else if (args[i] === "--extension" || args[i] === "-e")
    extensions.push(args[++i]);
  else if (args[i] === "--mode" && args[i + 1] === "rpc") i++;
  else throw new Error(`Unsupported Pi startup argument: ${args[i]}`);
}

const agentDir = sdk.getAgentDir();
const trustStore = new sdk.ProjectTrustStore(agentDir);
const excluded = new Set();
let readMcpCatalog;
process.on("message", (message) => {
  if (message?.type !== "mcp_catalog") return;
  try {
    process.send?.({ id: message.id, result: readMcpCatalog() });
  } catch {
    process.send?.({ id: message.id, error: "Pi MCP 目录读取失败。" });
  }
});
const createRuntime = async ({
  cwd,
  sessionManager,
  sessionStartEvent,
  projectTrustContext,
}) => {
  let configured = { servers: [], errors: [] };
  const mcp = sdk.createMcpExtension({
    loadConfig(ctx) {
      configured = loadMcpConfig({
        agentDir,
        cwd: ctx.cwd,
        projectTrusted: ctx.isProjectTrusted(),
      });
      return configured;
    },
  });
  const files = new FileSettingsStorage(cwd, agentDir);
  const settingsManager = sdk.SettingsManager.fromStorage(
    {
      withLock(scope, update) {
        files.withLock(scope, (current) => {
          const settings = JSON.parse(current?.replace(/^\uFEFF/, "") || "{}");
          const paths = [...excluded].map((path) => `-${path}`);
          const next = update(
            JSON.stringify({
              ...settings,
              extensions: [...(settings.extensions ?? []), ...paths],
            }),
          );
          if (next === undefined) return;
          const saved = JSON.parse(next);
          saved.extensions = (saved.extensions ?? []).filter(
            (path) =>
              !paths.includes(path) || settings.extensions?.includes(path),
          );
          return JSON.stringify(saved);
        });
      },
    },
    { projectTrusted: false },
  );
  const retained = (result) => ({
    ...result,
    extensions: result.extensions.filter((extension) => {
      const conflict =
        extension.path !== "builtin:mcp" &&
        (extension.commands.has("mcp") ||
          extension.handlers.has("mcp_servers_change"));
      if (conflict) {
        excluded.add(extension.resolvedPath);
        console.error(
          `Domos: MCP ownership stays with Pi; excluded ${extension.path}`,
        );
      }
      return !conflict;
    }),
  });
  applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy);
  configureHttpDispatcher(settingsManager.getHttpIdleTimeoutMs());
  const services = await sdk.createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager,
    resourceLoaderOptions: {
      additionalExtensionPaths: extensions,
      appendSystemPrompt: instructions ? [instructions] : undefined,
      extensionFactories: [
        { name: "mcp", builtin: true, factory: mcp },
        {
          name: "domos-mcp-catalog",
          builtin: true,
          factory(pi) {
            readMcpCatalog = () => {
              const entries = [...configured.servers];
              for (const item of pi.getMcpServers()) {
                const namespace = (name) => name.replaceAll("-", "_");
                if (
                  !entries.some(
                    (entry) => namespace(entry.name) === namespace(item.name),
                  )
                )
                  entries.push({
                    name: item.name,
                    config: item.config,
                    source: item.extensionPath,
                  });
              }
              return {
                items: entries.map(({ name, source, config }) => ({
                  name,
                  source,
                  enabled: config.enabled !== false,
                  status: "unknown",
                })),
                errors: configured.errors.map((message) => ({ message })),
              };
            };
          },
        },
        {
          name: "tool-search",
          builtin: true,
          replaceable: true,
          factory: sdk.createToolSearchExtension(),
        },
        {
          name: "codemode",
          builtin: true,
          replaceable: true,
          factory: sdk.createCodemodeExtension(),
        },
      ],
      extensionsOverride: retained,
    },
    resourceLoaderReloadOptions: {
      resolveProjectTrust: ({ extensionsResult }) =>
        resolveProjectTrusted({
          cwd,
          trustStore,
          defaultProjectTrust: settingsManager.getDefaultProjectTrust(),
          extensionsResult: retained(extensionsResult),
          projectTrustContext:
            projectTrustContext ??
            createProjectTrustContext({
              cwd,
              mode: "rpc",
              hasUI: false,
              settingsManager,
            }),
        }),
    },
  });
  const created = await sdk.createAgentSessionFromServices({
    services,
    sessionManager,
    sessionStartEvent,
  });
  return { ...created, services, diagnostics: services.diagnostics };
};
const cwd = process.cwd();
const runtime = await sdk.createAgentSessionRuntime(createRuntime, {
  cwd,
  agentDir,
  sessionManager: sdk.SessionManager.create(cwd, sessionDir),
});
await sdk.runRpcMode(runtime);
