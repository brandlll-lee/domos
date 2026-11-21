import { useEffect, useSyncExternalStore } from "react";

const images = new Map<
  string,
  {
    status: "loading" | "ready" | "failed";
    done: Promise<void>;
    image: HTMLImageElement;
  }
>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const avatarImageStatus = (url: string) => images.get(url)?.status;

export function prepareAvatarImages(urls: readonly string[]) {
  return Promise.all(
    urls.map((url) => {
      const pending = images.get(url);
      if (pending) return pending.done;
      const image = new Image();
      // Chromium can defer low-priority images behind long-lived workspace streams.
      image.fetchPriority = "high";
      image.src = url;
      const entry: NonNullable<ReturnType<typeof images.get>> = {
        status: "loading",
        image,
        done: new Promise<void>((resolve) => {
          const timer = window.setTimeout(() => {
            image.src = "";
            finish("failed");
          }, 15_000);
          function finish(status: "ready" | "failed") {
            if (entry.status !== "loading") return;
            window.clearTimeout(timer);
            settle(status);
            resolve();
          }
          void image.decode().then(
            () => finish("ready"),
            () => finish("failed"),
          );
        }),
      };
      function settle(status: "ready" | "failed") {
        entry.status = status;
        for (const listener of listeners) listener();
      }
      images.set(url, entry);
      return entry.done;
    }),
  );
}

export function retryAvatarImages(urls: readonly string[]) {
  for (const url of urls)
    if (avatarImageStatus(url) === "failed") images.delete(url);
  const pending = prepareAvatarImages(urls);
  for (const listener of listeners) listener();
  return pending;
}

export function useAvatarImages(urls: readonly string[]) {
  const status = useSyncExternalStore(
    subscribe,
    () => {
      if (
        urls.some((url) => {
          const current = avatarImageStatus(url);
          return !current || current === "loading";
        })
      )
        return "loading";
      return urls.some((url) => avatarImageStatus(url) === "failed")
        ? "failed"
        : "ready";
    },
    () => "ready",
  );
  useEffect(() => {
    void prepareAvatarImages(urls);
  }, [urls]);
  return status;
}
