import type { Paragraph, Root } from "mdast";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { type ComponentProps, memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];
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
}: {
  children: string;
}) {
  return (
    <div className="markdown">
      <Markdown remarkPlugins={plugins} skipHtml components={components}>
        {children}
      </Markdown>
    </div>
  );
});
