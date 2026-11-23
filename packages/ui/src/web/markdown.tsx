import type { Paragraph, Root, RootContent } from "mdast";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { type ComponentProps, memo, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import { markdownPlugins } from "../markdown-plugins.ts";

const autolinks = gfmAutolinkLiteralFromMarkdown();
function MessageLink({ href, title, children }: ComponentProps<"a">) {
  let icon: string | undefined;
  if (href && URL.canParse(href)) {
    const url = new URL(href);
    if (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      icon = `${url.origin}/favicon.ico`;
  }
  return (
    <a
      className="message-link"
      href={href}
      title={title}
      target="_blank"
      rel="noopener noreferrer"
    >
      {icon && (
        <span className="message-link-icon" aria-hidden="true">
          <span />
          <img
            key={icon}
            src={icon}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        </span>
      )}
      {children}
    </a>
  );
}
const components: Components = {
  a: MessageLink,
  table: ({ children }) => (
    <div className="markdown-table">
      <table>{children}</table>
    </div>
  ),
};

export const MessageText = memo(function MessageText({
  children,
}: {
  children: string;
}) {
  const paragraph: Paragraph = {
    type: "paragraph",
    children: [{ type: "text", value: children }],
  };
  const tree: Root = { type: "root", children: [paragraph] };
  for (const transform of autolinks.transforms ?? []) transform(tree);
  let offset = 0;
  return paragraph.children.map((node) => {
    const key = offset;
    const text =
      node.type === "text"
        ? node.value
        : node.type === "link"
          ? node.children
              .map((child) => (child.type === "text" ? child.value : ""))
              .join("")
          : "";
    offset += text.length;
    return node.type === "link" ? (
      <MessageLink key={key} href={node.url}>
        {text}
      </MessageLink>
    ) : (
      text
    );
  });
});

export const MessageMarkdown = memo(function MessageMarkdown({
  children,
  references = [],
}: {
  children: string;
  references?: { id: string; label: string; content: ReactNode }[];
}) {
  const referenceLinks = new Map(
    references.map((item) => [`#bot/${item.id}`, item.content]),
  );
  const mentions = () => (tree: Root) => {
    const walk = (parent: { children: RootContent[] }) => {
      parent.children = parent.children.flatMap((node) => {
        if (node.type === "text") {
          const parts: RootContent[] = [];
          let offset = 0;
          const labels = [...references].sort(
            (a, b) => b.label.length - a.label.length,
          );
          while (offset < node.value.length) {
            const at = node.value.indexOf("@", offset);
            if (at < 0) {
              parts.push({ type: "text", value: node.value.slice(offset) });
              break;
            }
            if (at > offset)
              parts.push({ type: "text", value: node.value.slice(offset, at) });
            const ref = labels.find(
              (item) =>
                (at === 0 ||
                  /[\s(（“"，。:：;；!?！？]/u.test(
                    node.value[at - 1] ?? "",
                  )) &&
                node.value.startsWith(item.label, at + 1) &&
                (!node.value[at + 1 + item.label.length] ||
                  /[\s.,，。:：;；!?！？]/u.test(
                    node.value[at + 1 + item.label.length] ?? "",
                  )),
            );
            if (ref) {
              parts.push({
                type: "link",
                url: `#bot/${ref.id}`,
                children: [{ type: "text", value: `@${ref.label}` }],
              });
              offset = at + ref.label.length + 1;
            } else {
              parts.push({ type: "text", value: "@" });
              offset = at + 1;
            }
          }
          return parts;
        }
        if (
          "children" in node &&
          node.type !== "link" &&
          node.type !== "linkReference"
        )
          walk(node as { children: RootContent[] });
        return [node];
      });
    };
    walk(tree);
  };
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={
          references.length ? [...markdownPlugins, mentions] : markdownPlugins
        }
        skipHtml
        components={{
          ...components,
          a: (props) =>
            referenceLinks.get(props.href ?? "") ?? <MessageLink {...props} />,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
});
