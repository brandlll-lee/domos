import type { ChatMessage } from "@domos/agent/messages";
import { client } from "../../client.ts";
import { createReadState } from "../read-state.ts";

const files = new Map<number, Map<string, ReturnType<typeof createFile>>>();
const lists = new Map<number, Map<string, ReturnType<typeof createList>>>();
const revisions = new Map<number, string>();
function createFile(botId: number, id: string) {
  return createReadState((signal) =>
    client.files.download({ botId, id }, { signal }),
  );
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
function createList(botId: number, query: string) {
  let offset = 0;
  const read = createReadState<Awaited<ReturnType<typeof client.files.list>>>(
    async (signal): Promise<Awaited<ReturnType<typeof client.files.list>>> => {
      const page = await client.files.list(
        { botId, query, offset },
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
export function fileList(botId: number, query: string) {
  let items = lists.get(botId);
  if (!items) {
    items = new Map();
    lists.set(botId, items);
  }
  let store = items.get(query);
  if (!store) {
    store = createList(botId, query);
    items.set(query, store);
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
  for (const [id, items] of files)
    if (!ids?.has(id)) {
      for (const store of items.values()) store.dispose();
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
