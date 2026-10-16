import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import type { HostingStore } from "./store.ts";

export function persistentCredentials(store: HostingStore): CredentialStore {
  const read = async (id: string) => {
    const row = store.db
      .prepare("SELECT value FROM credentials WHERE provider=?")
      .get(id);
    return row
      ? (store.decrypt(row.value as Uint8Array, id) as Credential)
      : undefined;
  };
  return {
    read,
    async list() {
      return store.db
        .prepare("SELECT provider AS providerId, type FROM credentials")
        .all() as {
        providerId: string;
        type: Credential["type"];
      }[];
    },
    modify(id, update) {
      return store.transact(async () => {
        const value = await update(await read(id));
        if (value)
          store.db
            .prepare(
              "INSERT INTO credentials VALUES (?, ?, ?) ON CONFLICT(provider) DO UPDATE SET type=excluded.type,value=excluded.value",
            )
            .run(id, value.type, store.encrypt(value, id));
        return value ?? (await read(id));
      });
    },
    delete(id) {
      return store.transact(async () => {
        store.db.prepare("DELETE FROM credentials WHERE provider=?").run(id);
      });
    },
  };
}
