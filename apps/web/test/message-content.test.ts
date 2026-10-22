import type { ChatMessage } from "@domos/agent/messages";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MessageContent } from "../src/features/chat/message-content.tsx";

test("images precede captions while each group retains its order", () => {
  const content: ChatMessage["content"] = [
    { type: "text", key: "a", text: "First caption" },
    { type: "image", key: "b", mimeType: "image/png", data: "first" },
    { type: "text", key: "c", text: "Second caption" },
    { type: "image", key: "d", mimeType: "image/png", data: "second" },
  ];
  const html = renderToStaticMarkup(
    createElement(MessageContent, { content, user: true }),
  );
  const images = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(
    (match) => match[1],
  );
  expect(images).toEqual([
    "data:image/png;base64,first",
    "data:image/png;base64,second",
  ]);
  expect(html.lastIndexOf("<img")).toBeLessThan(html.indexOf("First caption"));
  expect(html.indexOf("First caption")).toBeLessThan(
    html.indexOf("Second caption"),
  );
  expect(content.map((part) => part.key)).toEqual(["a", "b", "c", "d"]);
});
