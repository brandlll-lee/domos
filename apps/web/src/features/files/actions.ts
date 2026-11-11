import type { Attachment } from "@domos/agent/attachments";

export function fileUrl(botId: number, id: string, download = false) {
  return `/files/${botId}/${id}${download ? "?download=1" : ""}`;
}

export async function fileAction(
  botId: number,
  file: Attachment,
  action: "save" | "open" | "reveal",
) {
  if (window.domosDesktop) {
    const result = await window.domosDesktop.file({
      action,
      botId,
      id: file.id,
    });
    if (!result.ok) throw new Error(result.error ?? "文件操作未完成。");
  } else {
    const link = document.createElement("a");
    link.href = fileUrl(botId, file.id, true);
    link.download = file.name;
    link.click();
  }
}
