import {
  type Attachment,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
} from "@domos/agent/attachments";
import { useEffect, useRef, useState } from "react";
import { client } from "../../client.ts";
import { userError } from "../user-error.ts";

type Upload = {
  id: string;
  file: File;
  status: "uploading" | "failed";
  error?: string;
  cancelled: boolean;
  started: boolean;
  attachment?: Attachment;
};

export function useUploads(
  botId: number,
  count: number,
  attach: (file: Attachment) => boolean,
) {
  const [items, setItems] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const tasks = useRef(new Map<string, Upload>());
  const active = useRef(true);
  const queue = useRef(Promise.resolve());
  const latest = useRef({ count, attach });
  latest.current = { count, attach };
  useEffect(() => {
    active.current = true;
    const current = tasks.current;
    return () => {
      active.current = false;
      for (const item of current.values()) item.cancelled = true;
    };
  }, []);
  function refresh() {
    if (active.current)
      setItems([...tasks.current.values()].map((item) => ({ ...item })));
  }
  function upload(item: Upload) {
    item.status = "uploading";
    item.error = undefined;
    refresh();
    queue.current = queue.current.then(async () => {
      if (item.cancelled && !item.started) {
        tasks.current.delete(item.id);
        refresh();
        return;
      }
      try {
        item.started = true;
        const file =
          item.attachment ??
          (await client.files.upload({
            botId,
            file: item.file,
            requestId: item.id,
          }));
        item.attachment = file;
        if (item.cancelled || !active.current)
          await client.files.discard({ botId, id: file.id });
        else latest.current.attach(file);
        tasks.current.delete(item.id);
      } catch (cause) {
        item.status = "failed";
        item.error = userError(
          cause,
          item.cancelled
            ? `${item.file.name}：清理未确认，请重试。`
            : `${item.file.name}：上传失败，请重试。`,
        );
      }
      refresh();
    });
  }
  return {
    items,
    error,
    busy: items.some((item) => item.status === "uploading"),
    add(files: FileList | File[]) {
      setError(null);
      if (
        latest.current.count + tasks.current.size + files.length >
        MAX_ATTACHMENTS
      ) {
        setError(`最多添加 ${MAX_ATTACHMENTS} 个文件。`);
        return;
      }
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_BYTES) {
          setError(`${file.name}：文件大小超过 10 MiB。`);
          continue;
        }
        const item: Upload = {
          id: crypto.randomUUID(),
          file,
          status: "uploading",
          cancelled: false,
          started: false,
        };
        tasks.current.set(item.id, item);
        upload(item);
      }
    },
    cancel(id: string) {
      const item = tasks.current.get(id);
      if (item) {
        item.cancelled = true;
        if (item.status === "failed") upload(item);
      }
      refresh();
    },
    retry(id: string) {
      const item = tasks.current.get(id);
      if (item?.status === "failed") upload(item);
    },
    async remove(id: string, remove: () => void) {
      try {
        await client.files.discard({ botId, id });
        remove();
      } catch (cause) {
        setError(userError(cause, "附件清理失败，请重试。"));
      }
    },
  };
}
