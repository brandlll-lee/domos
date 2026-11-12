export function openCodeRequest(
  name:
    | "skills"
    | "mcp"
    | "providers"
    | "authMethods"
    | "authorize"
    | "callback"
    | "saveKey"
    | "removeKey"
    | "messages",
  id?: string,
): [path: string, method: string];
