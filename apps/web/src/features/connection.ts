import { useSyncExternalStore } from "react";
import type { DesktopState } from "./hosting/desktop.ts";

type Connection = { service?: DesktopState["service"]; connected?: boolean };
let current: Connection = {};
const listeners = new Set<() => void>();
export function receiveConnection(value: Partial<Connection>) {
  if (
    Object.entries(value).every(
      ([key, next]) => current[key as keyof Connection] === next,
    )
  )
    return;
  current = { ...current, ...value };
  for (const listener of listeners) listener();
}
window.addEventListener("domos:service", (event) => {
  receiveConnection({
    service: (event as CustomEvent<DesktopState["service"]>).detail,
  });
});
export function useConnection() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}
