export const browserObservations = new Set([
  "agent_browser_snapshot",
  "agent_browser_screenshot",
  "agent_browser_get_text",
  "agent_browser_get_url",
  "agent_browser_get_title",
  "agent_browser_tab_list",
]);

const runtimeArguments = new Set([
  "allowedDomains",
  "caCert",
  "clearCaCert",
  "extraArgs",
  "headed",
  "idleTimeout",
  "namespace",
  "restore",
  "restoreCheckFn",
  "restoreCheckText",
  "restoreCheckUrl",
  "restoreSave",
  "session",
  "timeoutMs",
  "useSystemCa",
  "webgpu",
  "webmcp",
  "all",
  "path",
  "screenshotDir",
]);

export const browserRestart = {
  name: "agent_browser_restart",
  description:
    "Restart this Bot's browser after an unknown result. Closes all its tabs and loses unsaved input. Saved profile data remains. Inspect the task outcome before retrying any action.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

export function browserTool(tool) {
  const properties = Object.fromEntries(
    Object.entries(tool.inputSchema.properties ?? {}).filter(
      ([key]) => !runtimeArguments.has(key),
    ),
  );
  const inputSchema = {
    ...tool.inputSchema,
    properties,
    additionalProperties: false,
  };
  if (inputSchema.required)
    inputSchema.required = inputSchema.required.filter((key) =>
      Object.hasOwn(properties, key),
    );
  return { ...tool, inputSchema };
}

export function browserArguments(tool, args) {
  for (const key of Object.keys(args))
    if (!Object.hasOwn(tool.inputSchema.properties, key))
      throw new Error(
        `Browser argument ${key} is not available. No action was sent.`,
      );
  return args;
}

export function browserResult(result) {
  // Keep native structured output intact; bound only the text shown to the model.
  let remaining = 32000;
  return {
    ...result,
    content: result.content.map((part) => {
      if (part.type !== "text") return part;
      const text = part.text.slice(0, remaining);
      remaining -= text.length;
      return {
        ...part,
        text:
          text.length < part.text.length
            ? `${text}\n[Text truncated. Read a narrower page scope.]`
            : text,
      };
    }),
  };
}
