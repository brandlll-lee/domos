import { ORPCError } from "@orpc/client";

export function userError(cause: unknown, fallback: string) {
  if (cause instanceof ORPCError) {
    const message = cause.message.trim();
    if (/[\u3400-\u9fff]/.test(message)) return message;
    switch (cause.code) {
      case "UNAUTHORIZED":
        return "登录已过期，请重新登录。";
      case "FORBIDDEN":
        return "当前账号没有这项权限。";
      case "NOT_FOUND":
        return "内容不存在，或当前服务尚不支持此操作。";
      case "CONFLICT":
        return "内容已在别处更新，请刷新后重试。";
      case "PRECONDITION_FAILED":
        return "当前状态不允许此操作。";
      case "BAD_REQUEST":
        return "提交的内容不完整，请检查后重试。";
      case "SERVICE_UNAVAILABLE":
        return "服务暂时不可用，请稍后重试。";
      case "NOT_IMPLEMENTED":
        return "当前服务版本不支持此操作。";
      case "TOO_MANY_REQUESTS":
        return "操作太频繁，请稍后再试。";
      case "TIMEOUT":
        return "服务响应超时，请重试。";
    }
    return fallback;
  }
  if (cause instanceof TypeError) return fallback;
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return fallback;
}
