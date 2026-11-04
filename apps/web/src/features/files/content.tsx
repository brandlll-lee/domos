import { type Attachment, filePreviewKind } from "@domos/agent/attachments";
import { Button } from "@domos/ui/controls";
import { MessageMarkdown } from "@domos/ui/markdown";
import { lazy, Suspense, useEffect, useState } from "react";
import { useFilePreview } from "./context.tsx";
import { HtmlPreview } from "./html.tsx";
import { useFile } from "./use-file.ts";

const PdfPreview = lazy(() => import("./pdf.tsx"));
const CsvPreview = lazy(() => import("./csv.tsx"));

export function FileContent({
  file,
  blob,
  inline = false,
}: {
  file: Attachment;
  blob: Blob;
  inline?: boolean;
}) {
  const preview = useFilePreview();
  const kind = filePreviewKind({ ...file, mimeType: blob.type });
  const [text, setText] = useState<string>();
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    if (["text", "markdown", "html"].includes(kind)) {
      void blob
        .arrayBuffer()
        .then((bytes) => {
          const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
            bytes,
          );
          if (active) setText(decoded);
        })
        .catch(() => {
          if (active) setError(true);
        });
    }
    return () => {
      active = false;
    };
  }, [blob, kind]);
  if (error) return <p role="alert">无法读取文件内容。你仍可下载原文件。</p>;
  if (kind === "download")
    return <p className="file-empty">此格式暂不支持预览，请下载后查看。</p>;
  return (
    <Suspense fallback={<p role="status">正在打开文件…</p>}>
      {kind === "pdf" && <PdfPreview blob={blob} />}
      {kind === "csv" && <CsvPreview blob={blob} />}
      {["text", "markdown", "html"].includes(kind) && text === undefined && (
        <p role="status">正在读取内容…</p>
      )}
      {text !== undefined && kind === "html" && (
        <HtmlPreview
          html={text}
          title={file.name}
          inline={inline}
          target={
            inline && preview?.selected === file.id ? preview.target : undefined
          }
        />
      )}
      {text !== undefined && kind === "markdown" && (
        <div className="file-document">
          <MessageMarkdown>{text.slice(0, 200_000)}</MessageMarkdown>
          {text.length > 200_000 && (
            <p>仅预览前 200,000 个字符。下载可查看完整内容。</p>
          )}
        </div>
      )}
      {text !== undefined && kind === "text" && (
        <div className="file-document">
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              void navigator.clipboard
                .writeText(text)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? "已复制" : "复制"}
          </Button>
          <pre className="file-source">{text.slice(0, 200_000)}</pre>
          {text.length > 200_000 && (
            <p>仅预览前 200,000 个字符。下载可查看完整内容。</p>
          )}
        </div>
      )}
    </Suspense>
  );
}

export function InlineFile({
  botId,
  file,
}: {
  botId: number;
  file: Attachment;
}) {
  const preview = useFilePreview();
  const register = preview?.register;
  useEffect(() => {
    register?.(file.id, true);
    return () => register?.(file.id, false);
  }, [file.id, register]);
  const data = useFile(botId, file);
  return (
    <div className="inline-file">
      {data.blob && (
        <FileContent key={file.id} file={file} blob={data.blob} inline />
      )}
      {data.error && (
        <p role="alert">
          {data.error}
          <Button variant="ghost" size="small" onClick={data.retry}>
            重试
          </Button>
        </p>
      )}
      {!data.blob && !data.error && <p role="status">正在打开页面…</p>}
    </div>
  );
}
