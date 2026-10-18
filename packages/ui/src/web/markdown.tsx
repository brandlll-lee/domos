import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];
const components: Components = {
  table: ({ children }) => (
    <div className="markdown-table">
      <table>{children}</table>
    </div>
  ),
};

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
