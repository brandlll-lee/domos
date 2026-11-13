import type { LinkCard as LinkContent } from "@domos/agent/messages";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { client } from "../../client.ts";
import { createReadState } from "../read-state.ts";

function createPreview(botId: number, url: string) {
  return {
    read: createReadState((signal) =>
      client.files.linkPreview({ botId, url }, { signal }),
    ),
    readers: 0,
  };
}
const previews = new Map<string, ReturnType<typeof createPreview>>();
function clearPreviews() {
  for (const preview of previews.values()) preview.read.dispose();
  previews.clear();
}
window.addEventListener("domos:computer", clearPreviews);
window.addEventListener("domos:pair", clearPreviews);

export function LinkCard({
  botId,
  link,
}: {
  botId: number;
  link: LinkContent;
}) {
  let target: URL | undefined;
  try {
    const url = new URL(link.url);
    if (url.protocol === "https:" && !url.username && !url.password)
      target = url;
  } catch {}
  const key = JSON.stringify([botId, link.url]);
  let store = previews.get(key);
  if (!store) {
    store = createPreview(botId, link.url);
    previews.set(key, store);
    if (previews.size > 100) {
      const oldest = [...previews].find(
        ([id, state]) => id !== key && !state.readers,
      );
      if (oldest) {
        oldest[1].read.dispose();
        previews.delete(oldest[0]);
      }
    }
  }
  const preview = useSyncExternalStore(
    store.read.subscribe,
    store.read.snapshot,
  ).data;
  const element = useRef<HTMLElement>(null);
  const valid = !!target;
  useEffect(() => {
    if (!element.current || !valid) return;
    let retained = false;
    const release = () => {
      if (!retained) return;
      retained = false;
      if (--store.readers === 0 && store.read.snapshot().loading)
        store.read.invalidate();
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        if (!retained) {
          retained = true;
          store.readers++;
        }
        void store.read.load().catch(() => {});
      } else release();
    });
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      release();
    };
  }, [store, valid]);
  return (
    <section
      ref={element}
      className="link-card"
      aria-label={link.title ?? preview?.title ?? link.label}
    >
      {preview?.thumbnail?.startsWith("data:image/") && (
        <img
          className="link-card-cover"
          src={preview.thumbnail}
          alt=""
          loading="lazy"
        />
      )}
      <div className="link-card-copy">
        {(link.title || preview?.title) && (
          <strong>{link.title ?? preview?.title}</strong>
        )}
        <p>{link.body}</p>
        {link.footer && <small>{link.footer}</small>}
        {target && (
          <small className="link-card-domain">{target.hostname}</small>
        )}
      </div>
      <a
        className="link-card-action"
        href={target?.href}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        aria-disabled={!valid || undefined}
      >
        <ArrowSquareOutIcon aria-hidden />
        <span>{link.label}</span>
      </a>
    </section>
  );
}
