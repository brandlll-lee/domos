import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import type { EngineAnswer, EngineApproval, EngineConfig } from "../types.ts";

export async function answerAcpPermission(
  request: RequestPermissionRequest,
  config: EngineConfig,
  id: string,
  ask: (approval: EngineApproval) => Promise<EngineAnswer>,
): Promise<RequestPermissionResponse> {
  const question = String(request.toolCall.toolCallId ?? "").startsWith(
    "interaction_",
  );
  const permissionOptions = request.options.filter(
    (option) =>
      config.provider !== "devin" ||
      config.approvalMode === "full" ||
      option.kind !== "allow_always",
  );
  const options = permissionOptions.map((option) => ({
    id: option.optionId,
    label: option.name,
  }));
  const title =
    request.toolCall.title ?? (question ? "需要你的回答" : "工具权限请求");
  const answer = await ask({
    id,
    title: question ? title : "允许这次操作？",
    detail: question ? "" : title,
    ...(!question && request.toolCall.rawInput
      ? {
          fields: Object.entries(
            typeof request.toolCall.rawInput === "object"
              ? request.toolCall.rawInput
              : { 参数: request.toolCall.rawInput },
          ).map(([label, value]) => ({
            label,
            value:
              typeof value === "string" ? value : (JSON.stringify(value) ?? ""),
          })),
        }
      : {}),
    kind: question ? "question" : "permission",
    automatic: !question,
    ...(question ? { questions: [{ id, title, options }] } : { options }),
  });
  const selected = question ? answer.answers?.[id]?.[0] : answer.optionId;
  const option = selected
    ? permissionOptions.find(
        (item) =>
          item.optionId === selected &&
          (question ||
            (answer.allow
              ? item.kind.startsWith("allow_")
              : item.kind.startsWith("reject_"))),
      )
    : !question
      ? (permissionOptions.find(
          (item) => item.kind === (answer.allow ? "allow_once" : "reject_once"),
        ) ??
        permissionOptions.find(
          (item) =>
            item.kind === (answer.allow ? "allow_always" : "reject_always") &&
            (config.provider !== "devin" ||
              !answer.allow ||
              config.approvalMode === "full"),
        ))
      : undefined;
  return {
    outcome: option
      ? { outcome: "selected", optionId: option.optionId }
      : { outcome: "cancelled" },
  };
}
