import type { Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const markdown = unified().use(remarkParse).use(remarkGfm);

function nodeText(node: Nodes): string {
  if (node.type === "html" || node.type === "definition") return "";
  if (node.type === "break") return " ";
  if ("value" in node) return node.value;
  if ("alt" in node) return node.alt ?? "";
  if (!("children" in node)) return "";
  const text = node.children.map(nodeText);
  switch (node.type) {
    case "root":
    case "blockquote":
    case "list":
    case "listItem":
    case "table":
    case "tableRow":
      return text.join(" ");
    default:
      return text.join("");
  }
}

export function previewText(value: string) {
  return nodeText(markdown.parse(value)).replace(/\s+/g, " ").trim();
}
