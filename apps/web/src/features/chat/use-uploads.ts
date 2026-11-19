import {
  type Attachment,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MAX_MESSAGE_FILE_BYTES,
} from "@domos/agent/attachments";
import { useEffect, useRef, useState } from "react";
import { client } from "../../client.ts";
import { notifyError } from "../notices.tsx";
import { userError } from "../user-error.ts";

type Upload = {
  id: string;
  file: File;
  status: "uploading" | "failed";
  error?: string;
  cancelled: boolean;
  started: boolean;
  attachment?: Attachment;
  controller?: AbortController;
};

export function useUploads(
  botId: number,
  attachments: Attachment[],
  attach: (file: Attachment) => void,
) {
  const [items, setItems] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const tasks = useRef(new Map<string, Upload>());
  const active = useRef(true);
  const queue = useRef(Promise.resolve());
  const latest = useRef({ attachments, attach });
  latest.current = { attachments, attach };
  useEffect(() => {
    active.current = true;
    const current = tasks.current;
    return () => {
      active.current = false;
      for (const item of current.values()) {
        item.cancelled = true;
        item.controller?.abort();
      }
    };
  }, []);
  function refresh() {
    if (active.current)
      setItems(
        [...tasks.current.values()]
          .filter((item) => !item.cancelled)
          .map((item) => ({ ...item })),
      );
  }
  async function discard(id: string) {
    const noticeId = `attachment:${botId}:${id}`;
    try {
      await client.files.discard({ botId, id });
      notifyError("", noticeId);
    } catch (cause) {
      notifyError(userError(cause, "附件清理失败，请重试。"), noticeId, () =>
        discard(id),
      );
    }
  }
  async function remove(id: string, removeDraft: () => Promise<boolean>) {
    if (await removeDraft()) void discard(id);
    else
      notifyError(
        "附件移除尚未保存，请重试。",
        `attachment:${botId}:${id}`,
        () => remove(id, removeDraft),
      );
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
          (await (async () => {
            item.controller = new AbortController();
            const query = new URLSearchParams({
              name: item.file.name,
              requestId: item.id,
            });
            const response = await fetch(`/files/${botId}/upload?${query}`, {
              method: "PUT",
              body: item.file,
              signal: item.controller.signal,
            });
            if (!response.ok) throw new Error(await response.text());
            return (await response.json()) as Attachment;
          })());
        item.attachment = file;
        if (item.cancelled || !active.current) void discard(file.id);
        else latest.current.attach(file);
        tasks.current.delete(item.id);
      } catch (cause) {
        if (item.cancelled && !item.attachment) {
          tasks.current.delete(item.id);
          refresh();
          return;
        }
        item.status = "failed";
        item.error = userError(cause, `${item.file.name}：上传失败，请重试。`);
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
      const pending = [...tasks.current.values()].filter(
        (item) => !item.cancelled,
      );
      if (
        latest.current.attachments.length + pending.length + files.length >
        MAX_ATTACHMENTS
      ) {
        setError(`最多添加 ${MAX_ATTACHMENTS} 个文件。`);
        return;
      }
      let total = latest.current.attachments.reduce(
        (sum, file) => sum + file.size,
        0,
      );
      for (const item of pending) total += item.file.size;
      for (const file of Array.from(files)) {
        if (total + file.size > MAX_MESSAGE_FILE_BYTES) {
          setError(
            `每条消息的附件合计不能超过 ${Math.round(MAX_MESSAGE_FILE_BYTES / (1024 * 1024))} MiB。`,
          );
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          setError(`${file.name}：文件大小超过 100 MiB。`);
          continue;
        }
        total += file.size;
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
        item.controller?.abort();
        if (item.status === "failed") upload(item);
      }
      refresh();
    },
    retry(id: string) {
      const item = tasks.current.get(id);
      if (item?.status === "failed") upload(item);
    },
    remove,
  };
}
