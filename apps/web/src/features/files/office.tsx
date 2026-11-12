import type { Attachment } from "@domos/agent/attachments";
import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import PdfPreview from "./pdf.tsx";
import { useDocumentPreview } from "./use-file.ts";
export default function OfficePreview({
  botId,
  file,
}: {
  botId: number;
  file: Attachment;
}) {
  const state = useDocumentPreview(botId, file);
  if (state.error)
    return (
      <div className="file-preview-notice" role="alert">
        <InlineNotice>
          {state.error instanceof Error
            ? state.error.message
            : "Office 预览失败。"}
          <Button variant="ghost" size="small" onClick={state.retry}>
            重试
          </Button>
        </InlineNotice>
      </div>
    );
  if (!state.data) return <Loading label="正在生成文档预览" />;
  return (
    <div className="file-office">
      {state.data.kind === "pdf" && state.data.notice && (
        <div className="file-preview-notice">
          <InlineNotice>{state.data.notice}</InlineNotice>
        </div>
      )}
      <PdfPreview
        source={`/files/${botId}/${file.id}/preview?format=pdf`}
        botId={botId}
        file={file}
      />
    </div>
  );
}
