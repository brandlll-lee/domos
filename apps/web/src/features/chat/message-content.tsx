import type { InputMaterials } from "@domos/agent/materials";
import type { ChatMessage } from "@domos/agent/messages";
import { MessageMarkdown, MessageText } from "@domos/ui/markdown";
import { Fragment, useContext } from "react";
import { BotReference, TeamMembers } from "./bot-reference.tsx";
import { chatCopy } from "./copy.ts";
import { materialTokens } from "./material-tokens.tsx";

export function MessageContent({
  content,
  user = false,
  materials,
}: {
  content: ChatMessage["content"];
  user?: boolean;
  materials?: InputMaterials;
}) {
  const members = useContext(TeamMembers);
  const tokens = materialTokens(materials)
    .flatMap((token) =>
      token.position === undefined
        ? []
        : [{ ...token, position: token.position }],
    )
    .sort((a, b) => a.position - b.position);
  const parts =
    user && tokens.length
      ? [
          ...content.filter((part) => part.type !== "text"),
          {
            type: "text" as const,
            key: "materials",
            text: content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join(""),
          },
        ]
      : content;
  return parts
    .toSorted((a, b) => Number(b.type === "image") - Number(a.type === "image"))
    .map((part) => {
      switch (part.type) {
        case "text": {
          let offset = 0;
          return user ? (
            <div className="user-text" key={part.key}>
              {tokens.map((token, index) => {
                const end = Math.max(
                  offset,
                  Math.min(part.text.length, token.position - index),
                );
                const text = part.text.slice(offset, end);
                offset = end;
                return (
                  <Fragment key={token.id}>
                    <MessageText>{text}</MessageText>
                    <span
                      className="message-material-token"
                      title={token.title}
                    >
                      {token.content}
                    </span>
                  </Fragment>
                );
              })}
              <MessageText>{part.text.slice(offset)}</MessageText>
            </div>
          ) : (
            <MessageMarkdown
              key={part.key}
              references={members.map((bot) => ({
                id: String(bot.id),
                label: bot.name,
                content: <BotReference bot={{ ...bot, botId: bot.id }} />,
              }))}
            >
              {part.text}
            </MessageMarkdown>
          );
        }
        case "image":
          return (
            <img
              className="message-image"
              key={part.key}
              src={`data:${part.mimeType};base64,${part.data}`}
              alt={chatCopy.image}
            />
          );
        case "thinking":
        case "toolCall":
          return null;
      }
      const exhaustive: never = part;
      return exhaustive;
    });
}
