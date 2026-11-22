import { characterIdentity } from "@domos/ui/characters";
import { LoadingDots } from "@domos/ui/loading";
import { MessageBubble } from "@domos/ui/message";
import type { CSSProperties } from "react";
import { BotReference } from "./bot-reference.tsx";

export function TypingDots({
  label,
  status,
  author,
}: {
  label: string;
  status?: string | null;
  author?: { botId: number; name: string; avatar: string };
}) {
  return (
    <div
      className="typing-row"
      data-bot-id={author?.botId}
      style={
        author
          ? ({
              "--bot-color": characterIdentity(author.avatar).color,
            } as CSSProperties)
          : undefined
      }
    >
      {author && (
        <div className="message-author">
          <BotReference bot={author} />
        </div>
      )}
      <MessageBubble side="incoming">
        {status ? (
          <p className="working" role="status">
            {status}
          </p>
        ) : (
          <div className="typing-dots">
            <LoadingDots label={label} />
          </div>
        )}
      </MessageBubble>
    </div>
  );
}
