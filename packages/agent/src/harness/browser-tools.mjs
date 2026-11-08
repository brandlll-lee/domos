export const browserObservations = new Set([
  "agent_browser_observe",
  "agent_browser_snapshot",
  "agent_browser_screenshot",
  "agent_browser_get_text",
  "agent_browser_get_url",
  "agent_browser_get_title",
  "agent_browser_get_html",
  "agent_browser_get_value",
  "agent_browser_get_attr",
  "agent_browser_get_count",
  "agent_browser_get_box",
  "agent_browser_get_styles",
  "agent_browser_is_visible",
  "agent_browser_is_enabled",
  "agent_browser_is_checked",
  "agent_browser_dialog_status",
  "agent_browser_tab_list",
]);

export const browserObserve = {
  name: "agent_browser_observe",
  description:
    "Read current URL, title, document readiness, visible text and a compact page snapshot. Use after takeover or when a screenshot is unclear. Blank text or a ready document does not prove why a page is blank or that the task succeeded.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

export const browserPageScript = `(() => ({
  url: location.href, title: document.title, readyState: document.readyState,
  httpStatus: performance.getEntriesByType('navigation')[0]?.responseStatus || null,
  passwordFieldPresent: !!document.querySelector('input[type=password]'),
  challengePresent: !!document.querySelector('iframe[src*="challenges.cloudflare.com"],iframe[src*="recaptcha"],iframe[src*="hcaptcha"],#challenge-running'),
  text: (document.body?.innerText || '').slice(0, 12000),
  controls: Array.from(document.querySelectorAll('input:not([type=password]),textarea,select')).slice(0, 80).map(el => ({value: el.value.slice(0, 2000), checked: el.checked}))
}))()`;

export function browserAccess(page, result, requestedUrl, mode) {
  const error = result.isError
    ? result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
    : "";
  const httpStatus =
    Number(
      error.match(
        /\b(?:HTTP(?: ERROR)?\s*|status(?: code)?[: ]+)([45]\d\d)\b/i,
      )?.[1],
    ) ||
    page?.httpStatus ||
    null;
  const networkError = error.match(/net::ERR_[A-Z_]+/)?.[0] ?? null;
  const assessment = networkError
    ? "network_error"
    : page?.challengePresent
      ? "verification_required"
      : httpStatus === 403
        ? "access_denied"
        : httpStatus === 401
          ? "authentication_required"
          : result.isError
            ? "unconfirmed_failure"
            : page?.passwordFieldPresent
              ? "sign_in_form_present"
              : "unconfirmed";
  const evidence = `Browser access evidence: ${JSON.stringify({ requestedUrl, observedUrl: page?.url ?? null, mode, httpStatus, networkError, assessment })}.`;
  return result.isError ||
    [401, 403].includes(httpStatus) ||
    page?.challengePresent ||
    page?.passwordFieldPresent
    ? `${evidence} A sign-in form does not prove that login is required. A 403 does not identify its cause. Do not silently switch sites or use a personal browser. For a possible browser mode issue, ask the user to change mode in computer settings; this restarts the Bot browser and closes unsaved pages.`
    : evidence;
}

export function browserPageState(result) {
  const value = result.structuredContent?.response?.data?.result;
  if (
    result.isError ||
    !value ||
    typeof value.url !== "string" ||
    typeof value.title !== "string" ||
    typeof value.text !== "string"
  )
    return null;
  return value;
}

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
      ([key]) =>
        !runtimeArguments.has(key) &&
        !(key === "path" && tool.name === "agent_browser_screenshot"),
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

const managedCommands = new Set([
  "auth",
  "session",
  "state",
  "profiles",
  "tools",
  "skills",
  "plugin",
  "doctor",
  "dashboard",
  "install",
  "upgrade",
  "chat",
  "connect",
  "stream",
]);

function managedCommand(command) {
  return (
    managedCommands.has(command[0]) ||
    (command[0] === "get" &&
      command.slice(1).join("_").replaceAll("-", "_") === "cdp_url") ||
    (command[0] === "set" && command[1] === "credentials")
  );
}

export function browserToolListed(name) {
  return (
    name.startsWith("agent_browser_") &&
    !managedCommand(name.slice("agent_browser_".length).split("_"))
  );
}

export function browserBatchArguments(args) {
  const flags = new Set([
    ...[...runtimeArguments].map(
      (key) =>
        `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
    ),
    "--config",
    "--profile",
    "--download-path",
    "--cdp",
    "--auto-connect",
    "--executable-path",
    "--extension",
    "--browser",
    "--provider",
    "--proxy",
    "--proxy-bypass",
    "--proxy-username",
    "--proxy-password",
    "--args",
    "--allowed-domains",
    "--action-policy",
    "--confirm-actions",
    "--init-script",
    "--enable",
    "--session-name",
    "--user-agent",
    "--ignore-https-errors",
  ]);
  for (const command of args.commands ?? []) {
    if (
      !Array.isArray(command) ||
      !command.length ||
      command.some((part) => typeof part !== "string") ||
      command[0].startsWith("-") ||
      command[0] === "batch" ||
      managedCommand(command) ||
      command.some((part) => flags.has(part.split("=")[0]))
    )
      throw new Error(
        "Batch command is outside this Bot's browser tool boundary. No action was sent.",
      );
  }
  if (!args.commands?.length)
    throw new Error("Batch commands are required. No action was sent.");
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
