import type { Attachment } from "@domos/agent/attachments";
import type { InputMaterials } from "@domos/agent/materials";
import { useState, useSyncExternalStore } from "react";
import { computerScope } from "../../client.ts";
import { chatCopy } from "./copy.ts";
import type { SendInput } from "./use-chat.ts";

type Draft = {
  text: string;
  attachments: Attachment[];
  pending: SendInput | null;
  materials: InputMaterials;
};
const empty: Draft = {
  text: "",
  attachments: [],
  pending: null,
  materials: { skills: [], context: [] },
};
const storageError = chatCopy.errors.draft;

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("domos:composer", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((cause) => {
    database = undefined;
    throw cause;
  });
  return database;
}

async function read(key: string) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("drafts").objectStore("drafts").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function save(key: string, draft: Draft) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("drafts", "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.objectStore("drafts").put(draft, key);
  });
}

async function load(
  key: string,
  scope: string,
): Promise<{ draft: Draft; error: string | null; migration?: string }> {
  try {
    let value = await read(key);
    let migrated: string | undefined;
    if (value === undefined) {
      const owner = localStorage.getItem("domos:composer:owner");
      if (!owner) localStorage.setItem("domos:composer:owner", scope);
      migrated = key;
      let raw = localStorage.getItem(key);
      if (!raw && (!owner || owner === scope)) {
        migrated = `domos:composer:v1:${key.slice(key.lastIndexOf(":") + 1)}`;
        raw = localStorage.getItem(migrated);
      }
      if (!raw) return { draft: empty, error: null };
      value = JSON.parse(raw);
    }
    if (!value || typeof value !== "object") throw new Error("Invalid draft");
    const stored = value as Draft;
    if (
      typeof stored.text !== "string" ||
      (stored.pending !== null &&
        (typeof stored.pending?.text !== "string" ||
          typeof stored.pending?.requestId !== "string"))
    )
      throw new Error("Invalid draft");
    const attachments = stored.attachments ?? [];
    if (
      !Array.isArray(attachments) ||
      attachments.some(
        (file) =>
          typeof file.id !== "string" ||
          typeof file.name !== "string" ||
          typeof file.size !== "number" ||
          typeof file.path !== "string",
      )
    )
      throw new Error("Invalid attachments");
    const materials = stored.materials ?? { skills: [], context: [] };
    if (
      (materials.bots !== undefined &&
        (!Array.isArray(materials.bots) ||
          materials.bots.some(
            (item: NonNullable<InputMaterials["bots"]>[number]) =>
              typeof item.id !== "string" ||
              !Number.isInteger(item.botId) ||
              typeof item.name !== "string" ||
              typeof item.avatar !== "string" ||
              !Number.isInteger(item.position) ||
              item.position < 0,
          ))) ||
      (materials.mcp !== undefined &&
        (!Array.isArray(materials.mcp) ||
          materials.mcp.some(
            (item: NonNullable<InputMaterials["mcp"]>[number]) =>
              typeof item.id !== "string" ||
              typeof item.name !== "string" ||
              typeof item.available !== "boolean" ||
              typeof item.status !== "string" ||
              (item.position !== undefined &&
                (!Number.isInteger(item.position) || item.position < 0)),
          ))) ||
      !Array.isArray(materials.skills) ||
      !Array.isArray(materials.context) ||
      materials.skills.some(
        (item: InputMaterials["skills"][number]) =>
          typeof item.id !== "string" ||
          typeof item.name !== "string" ||
          (item.native
            ? typeof item.native.provider !== "string" ||
              typeof item.native.path !== "string" ||
              typeof item.native.source !== "string"
            : typeof item.revision !== "number" ||
              typeof item.content !== "string") ||
          (item.position !== undefined &&
            (!Number.isInteger(item.position) || item.position < 0)),
      ) ||
      materials.context.some(
        (item: InputMaterials["context"][number]) =>
          typeof item.id !== "string" ||
          typeof item.text !== "string" ||
          (item.position !== undefined &&
            (!Number.isInteger(item.position) || item.position < 0)) ||
          !["text", "message"].includes(item.type) ||
          (item.type === "message" && typeof item.messageId !== "string"),
      )
    )
      throw new Error("Invalid materials");
    const draft = { ...stored, attachments, materials };
    if (migrated) {
      try {
        await save(key, draft);
        localStorage.removeItem(migrated);
      } catch {
        return { draft, error: storageError, migration: migrated };
      }
    }
    return { draft, error: null };
  } catch {
    return { draft: empty, error: storageError };
  }
}

function createDraft(key: string) {
  let state: { draft: Draft; error: string | null; ready: boolean } = {
    draft: empty,
    error: null,
    ready: false,
  };
  const current = { current: state.draft };
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  let edits: Partial<Draft> | null = {};
  let migration: string | undefined;
  let writes = load(key, computerScope).then((loaded) => {
    migration = loaded.migration;
    current.current = { ...loaded.draft, ...edits };
    edits = null;
    state = { draft: current.current, error: loaded.error, ready: true };
    publish();
    return true;
  });
  return {
    current,
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(patch: Partial<Draft>) {
      const draft = { ...current.current, ...patch };
      current.current = draft;
      if (edits) Object.assign(edits, patch);
      state = { ...state, draft };
      publish();
      writes = writes.then(async () => {
        let saved = true;
        try {
          await save(key, current.current);
          if (migration) {
            localStorage.removeItem(migration);
            migration = undefined;
          }
          state = { ...state, draft: current.current, error: null };
        } catch {
          state = { ...state, draft: current.current, error: storageError };
          saved = false;
        }
        publish();
        return saved;
      });
      return writes;
    },
  };
}

const retained = new Map<string, ReturnType<typeof createDraft>>();
export function clearDraftState(ids?: Set<number>) {
  for (const id of retained.keys())
    if (!ids || (!id.startsWith("team:") && !ids.has(Number(id))))
      retained.delete(id);
}
window.addEventListener("domos:pair", () => clearDraftState());
window.addEventListener("domos:computer", () => clearDraftState());

export function useDraft(conversationId: number | string) {
  const key = String(conversationId);
  const [store] = useState(() => {
    let store = retained.get(key);
    if (!store) {
      store = createDraft(`domos:composer:v2:${computerScope}:${key}`);
      retained.set(key, store);
    }
    return store;
  });
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  return { ...state, current: store.current, update: store.update };
}
