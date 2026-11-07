import type { ChatMessage } from "@domos/agent/messages";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MessageContent } from "../src/features/chat/message-content.tsx";

test("user links preserve literal text, line breaks and URL punctuation", () => {
  const text =
    "**原文**\n  查看 https://example.com/page?q=1&x=2, 或 www.example.org。\n<script>原文</script>";
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: [{ type: "text", key: "a", text }],
      user: true,
    }),
  );
  expect(html).toContain('href="https://example.com/page?q=1&amp;x=2"');
  expect(html).toContain('class="message-link"');
  expect(html).toContain('src="https://example.com/favicon.ico"');
  expect(html).toContain("**原文**\n  查看 ");
  expect(html).toContain("&lt;script&gt;原文&lt;/script&gt;");
  expect(html).not.toContain("<strong>");
});

test("assistant links share website icons and keep unsafe URLs inert", () => {
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: [
        {
          type: "text",
          key: "a",
          text: "[来源](https://example.com/article) [危险](javascript:alert%281%29) [地址](https://)",
        },
      ],
    }),
  );
  expect(html).toContain('class="message-link"');
  expect(html).toContain('src="https://example.com/favicon.ico"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).not.toContain('href="javascript:');
});

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
