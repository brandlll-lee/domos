import { z } from "zod";

export const browserObservations = new Set([
  "agent_browser_observe",
  "agent_browser_snapshot",
  "agent_browser_screenshot",
  "agent_browser_get_text",
  "agent_browser_get_url",
  "agent_browser_get_title",
  "agent_browser_tab_list",
]);

export const browserSteps = z.strictObject({
  steps: z
    .array(
      z.discriminatedUnion("action", [
        z.strictObject({
          action: z.literal("click"),
          selector: z.string().min(1),
        }),
        z.strictObject({
          action: z.literal("fill"),
          selector: z.string().min(1),
          text: z.string().max(10000),
        }),
        z.strictObject({
          action: z.literal("type"),
          selector: z.string().min(1),
          text: z.string().max(10000),
        }),
        z.strictObject({
          action: z.literal("press"),
          key: z.string().min(1).max(64),
        }),
      ]),
    )
    .min(1)
    .max(24),
});

export const browserRunSteps = {
  name: "agent_browser_run_steps",
  description:
    "Run known clicks, fills, typing and keys in order, then observe once. Stop on an error. Use fresh refs. Split the batch when the next step depends on a page transition. Never replay completed or uncertain steps.",
  inputSchema: z.toJSONSchema(browserSteps),
};

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
