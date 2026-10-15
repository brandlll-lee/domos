import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];

export function MessageMarkdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={plugins}
        skipHtml
        components={{
          table: ({ children }) => (
            <div className="markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
