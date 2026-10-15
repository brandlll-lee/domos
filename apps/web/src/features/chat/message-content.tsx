import type { ChatMessage } from "@domos/agent/messages";
import { MessageMarkdown } from "@domos/ui/markdown";
import { chatCopy } from "./copy.ts";

export function MessageContent({
  message,
  results,
}: {
  message: ChatMessage;
  results: Map<string, ChatMessage>;
}) {
  const content = message.content.map((part) => {
    switch (part.type) {
      case "text":
        return message.role === "user" ? (
          <div className="user-text" key={part.key}>
            {part.text}
          </div>
        ) : (
          <MessageMarkdown key={part.key}>{part.text}</MessageMarkdown>
        );
      case "thinking":
        return (
          <details className="message-detail" key={part.key}>
            <summary>{chatCopy.thinking}</summary>
            <MessageMarkdown>{part.thinking}</MessageMarkdown>
          </details>
        );
      case "image":
        return (
          <img
            className="message-image"
            key={part.key}
            src={`data:${part.mimeType};base64,${part.data}`}
            alt={chatCopy.image}
          />
        );
      case "toolCall": {
        const result = results.get(part.id);
        return (
          <details className="message-detail" key={part.id}>
            <summary>
              <span>{part.name}</span>
              <span className="detail-status">
                {result
                  ? result.isError
                    ? chatCopy.toolFailed
                    : chatCopy.toolReturned
                  : chatCopy.toolWaiting}
              </span>
            </summary>
            <pre>{JSON.stringify(part.arguments, null, 2)}</pre>
          </details>
        );
      }
    }
    const exhaustive: never = part;
    return exhaustive;
  });
  return message.role === "toolResult" ? (
    <details className="message-detail" data-error={message.isError}>
      <summary>
        {message.toolName} ·{" "}
        {message.isError ? chatCopy.toolFailed : chatCopy.toolOutput}
      </summary>
      {content}
    </details>
  ) : (
    content
  );
}
