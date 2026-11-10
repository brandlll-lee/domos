import { materialText } from "@domos/agent/materials";
import type { ChatMessage } from "@domos/agent/messages";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MessageContent } from "../src/features/chat/message-content.tsx";

test("materials keep inline order in display and model input", () => {
  const materials = {
    skills: [
      {
        id: "report",
        revision: 1,
        name: "项目周报",
        content: "skill procedure",
        position: 1,
      },
    ],
    context: [
      {
        id: "quote",
        type: "text" as const,
        text: "保留现有数据",
        botId: 1,
        position: 3,
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(MessageContent, {
      content: [{ type: "text", key: "text", text: "请按检查" }],
      user: true,
      materials,
    }),
  );
  expect(html).toMatch(/请<span[^>]+class="message-material-token"/);
  expect(html).toMatch(/项目周报<\/span><\/span>按<span/);
  expect(html).toMatch(/保留现有数据<\/span><\/span>检查/);
  expect(html).not.toContain("skill procedure");
  const prompt = materialText("请按检查", materials);
  expect(prompt).not.toContain("skill procedure");
  expect(prompt).toContain("skill_read");
  expect(prompt).toContain('"id":"report"');
  expect(prompt).toContain("保留现有数据");
  expect(prompt).not.toContain('"position"');
  expect(prompt).toMatch(
    /^请<skill>.*<\/skill>按<reference>.*<\/reference>检查$/s,
  );
});

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

test("native skills and MCP references carry identities without contents or grants", () => {
  const prompt = materialText("先后", {
    skills: [
      {
        id: "native-path",
        revision: 0,
        name: "report",
        content: "private procedure",
        native: {
          provider: "pi",
          name: "report",
          source: "project",
          path: "/skills/report/SKILL.md",
        },
        position: 1,
      },
    ],
    context: [],
    mcp: [
      {
        id: "docs",
        name: "Docs",
        available: false,
        status: "configured",
        position: 2,
      },
    ],
  });
  expect(prompt).toMatch(
    /^先<skill>.*SKILL.md.*<\/skill><mcp>.*Docs.*<\/mcp>后$/s,
  );
  expect(prompt).not.toContain("private procedure");
  expect(prompt).toContain('"available":false');
  expect(prompt).toContain("does not grant");
});
