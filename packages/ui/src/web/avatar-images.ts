import { useEffect, useSyncExternalStore } from "react";

const images = new Map<
  string,
  { status: "loading" | "ready" | "failed"; done: Promise<void> }
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
      image.src = url;
      const entry: NonNullable<ReturnType<typeof images.get>> = {
        status: "loading",
        done: image.decode().then(
          () => settle("ready"),
          () => settle("failed"),
        ),
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
  void prepareAvatarImages(urls);
  for (const listener of listeners) listener();
}

export function useAvatarImages(urls: readonly string[]) {
  const status = useSyncExternalStore(subscribe, () => {
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
  });
  useEffect(() => {
    void prepareAvatarImages(urls);
  }, [urls]);
  return status;
}
