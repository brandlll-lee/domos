import { ORPCError } from "@orpc/client";

export function rejectionMessage(error: unknown) {
  if (!(error instanceof ORPCError)) return;
  switch (error.code) {
    case "CONFLICT":
      return "会话正在回复。请等待完成后再发送。";
    case "PRECONDITION_FAILED":
      return "模型尚未配置。请检查服务商凭据或选择其他模型。";
    case "BAD_REQUEST":
      return "消息格式有误。请修改后发送。";
  }
}
