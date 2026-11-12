import { type Attachment, filePreviewKind } from "@domos/agent/attachments";
import { FileDocIcon } from "@phosphor-icons/react/dist/csr/FileDoc";
import { FileMdIcon } from "@phosphor-icons/react/dist/csr/FileMd";
import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import { FilePptIcon } from "@phosphor-icons/react/dist/csr/FilePpt";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { FileXlsIcon } from "@phosphor-icons/react/dist/csr/FileXls";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { MusicNoteIcon } from "@phosphor-icons/react/dist/csr/MusicNote";
import { VideoCameraIcon } from "@phosphor-icons/react/dist/csr/VideoCamera";

export function fileIcon(file: Attachment) {
  const kind = filePreviewKind(file);
  if (kind === "pdf") return FilePdfIcon;
  if (kind === "markdown") return FileMdIcon;
  if (kind === "xlsx" || kind === "csv") return FileXlsIcon;
  if (/\.pptx?$/i.test(file.name)) return FilePptIcon;
  if (/\.docx?$/i.test(file.name)) return FileDocIcon;
  if (kind === "image") return ImageIcon;
  if (kind === "video") return VideoCameraIcon;
  if (kind === "audio") return MusicNoteIcon;
  return FileTextIcon;
}
