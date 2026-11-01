import type { ChatMessage } from "@domos/agent/messages";
import { type ReactNode, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { MessageContent } from "./message-content.tsx";

export function MessageDetail({
  botId,
  message,
  children,
}: {
  botId: number;
  message: ChatMessage;
  children?: (message: ChatMessage) => ReactNode;
}) {
  const [detail, setDetail] = useState<ChatMessage>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!message.detail) return;
    setError(false);
    setDetail(undefined);
    const controller = new AbortController();
    void client
      .message(
        { botId, id: message.id, cursor: message.cursor },
        { signal: controller.signal },
      )
      .then(
        (value) => {
          if (value) setDetail(value);
          else setError(true);
        },
        () => {
          if (!controller.signal.aborted) setError(true);
        },
      );
    return () => controller.abort();
  }, [botId, message]);
  if (error) return <p role="alert">记录读取失败，请重新打开。</p>;
  if (message.detail && !detail) return <p role="status">正在读取记录…</p>;
  if (children) return children(detail ?? message);
  return (
    <MessageContent
      content={(detail ?? message).content}
      user={message.role === "user"}
    />
  );
}
