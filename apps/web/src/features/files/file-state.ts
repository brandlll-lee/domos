import type { Attachment, FileCategory } from "@domos/agent/attachments";
import type { SpreadsheetPreview } from "@domos/agent/files";
import type { ChatMessage } from "@domos/agent/messages";
import { client } from "../../client.ts";
import { createReadState } from "../read-state.ts";

const files = new Map<number, Map<string, ReturnType<typeof createFile>>>();
const lists = new Map<number, Map<string, ReturnType<typeof createList>>>();
const revisions = new Map<number, string>();
export type FileSummary = {
  width?: number;
  height?: number;
  frames?: number;
  pages?: number;
  sheets?: number;
  duration?: number;
  waveform?: number[];
  thumbnail?: string;
};
const summaries = new Map<
  string,
  ReturnType<typeof createReadState<FileSummary>>
>();
let summaryQueue: Promise<unknown> = Promise.resolve();
export function fileSummary(botId: number, file: Attachment) {
  const key = JSON.stringify([botId, file.id]);
  let store = summaries.get(key);
  if (!store) {
    store = createReadState<FileSummary>((signal) => {
      const pending = summaryQueue
        .catch(() => {})
        .then(async () => {
          signal.throwIfAborted();
          const { readCardPreview } = await import("./card-preview.ts");
          return readCardPreview(botId, file, signal);
        });
      summaryQueue = pending;
      return pending;
    });
    summaries.set(key, store);
    if (summaries.size > MAX_CACHED_FILES) {
      const oldest = summaries.keys().next().value;
      if (oldest) {
        summaries.get(oldest)?.dispose();
        summaries.delete(oldest);
      }
    }
  }
  return store;
}
const previews = new Map<string, ReturnType<typeof createPreview>>();
const MAX_CACHED_BYTES = 64 * 1024 * 1024;
const MAX_CACHED_FILES = 100;
const retained = new Map<ReturnType<typeof createFile>, number>();
function createFile(botId: number, id: string) {
  const store = createReadState(async (signal) => {
    const response = await fetch(`/files/${botId}/${id}?download=1`, {
      signal,
    }).catch((cause) => {
      throw new Error("文件读取失败，请重试。", { cause });
    });
    if (!response.ok) throw new Error("文件读取失败，请重试。");
    const blob = await response.blob();
    retained.delete(store);
    retained.set(store, blob.size);
    let total = [...retained.values()].reduce((sum, size) => sum + size, 0);
    for (const [previous, size] of retained) {
      if (previous === store) continue;
      if (total <= MAX_CACHED_BYTES && retained.size <= MAX_CACHED_FILES) break;
      previous.clear();
      retained.delete(previous);
      total -= size;
    }
    return blob;
  });
  return store;
}
function createPreview(botId: number, id: string, sheet?: string) {
  const query =
    sheet === undefined ? "" : `?sheet=${encodeURIComponent(sheet)}`;
  const read = createReadState<SpreadsheetPreview>(async (signal) => {
    const response = await fetch(`/files/${botId}/${id}/preview${query}`, {
      signal,
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
  let readers = 0;
  return {
    read,
    botId,
    retain() {
      readers++;
      return () => {
        if (--readers === 0 && read.snapshot().loading) read.invalidate();
      };
    },
  };
}
export function previewState(botId: number, id: string, sheet?: string) {
  const key = JSON.stringify([botId, id, sheet]);
  let store = previews.get(key);
  if (!store) {
    store = createPreview(botId, id, sheet);
    previews.set(key, store);
    if (previews.size > MAX_CACHED_FILES) {
      const oldest = previews.keys().next().value;
      if (oldest) {
        previews.get(oldest)?.read.dispose();
        previews.delete(oldest);
      }
    }
  }
  return store;
}
export function fileState(botId: number, id: string) {
  let items = files.get(botId);
  if (!items) {
    items = new Map();
    files.set(botId, items);
  }
  let store = items.get(id);
  if (!store) {
    store = createFile(botId, id);
    items.set(id, store);
  }
  return store;
}
function createList(botId: number, query: string, category: FileCategory) {
  let offset = 0;
  const read = createReadState<Awaited<ReturnType<typeof client.files.list>>>(
    async (signal): Promise<Awaited<ReturnType<typeof client.files.list>>> => {
      const page = await client.files.list(
        { botId, query, category, offset },
        { signal },
      );
      return {
        ...page,
        items: offset
          ? [...(read.snapshot().data?.items ?? []), ...page.items]
          : page.items,
      };
    },
  );
  return {
    read,
    more() {
      const next = read.snapshot().data?.next;
      if (read.snapshot().loading || next == null) return;
      offset = next;
      void read.load(true).catch(() => {});
    },
    invalidate() {
      offset = 0;
      read.invalidate();
    },
  };
}
export function fileList(
  botId: number,
  query: string,
  category: FileCategory = "all",
) {
  let items = lists.get(botId);
  if (!items) {
    items = new Map();
    lists.set(botId, items);
  }
  const key = JSON.stringify([category, query]);
  let store = items.get(key);
  if (!store) {
    store = createList(botId, query, category);
    items.set(key, store);
  }
  return store;
}
export function receiveConversationFiles(
  botId: number,
  messages: ChatMessage[],
) {
  const revision = JSON.stringify(
    messages.flatMap((message) =>
      (message.attachments ?? []).map((file) => [message.id, file.id]),
    ),
  );
  if (revisions.get(botId) !== revision) {
    revisions.set(botId, revision);
    for (const store of lists.get(botId)?.values() ?? []) store.invalidate();
  }
}
export function clearFiles(ids?: Set<number>) {
  for (const store of summaries.values()) store.dispose();
  summaries.clear();
  for (const [key, store] of previews)
    if (!ids?.has(store.botId)) {
      store.read.dispose();
      previews.delete(key);
    }
  for (const [id, items] of files)
    if (!ids?.has(id)) {
      for (const store of items.values()) {
        store.dispose();
        retained.delete(store);
      }
      files.delete(id);
    }
  for (const [id, items] of lists)
    if (!ids?.has(id)) {
      for (const store of items.values()) store.read.dispose();
      lists.delete(id);
    }
  for (const id of revisions.keys()) if (!ids?.has(id)) revisions.delete(id);
}
window.addEventListener("domos:computer", () => clearFiles());
window.addEventListener("domos:pair", () => clearFiles());
