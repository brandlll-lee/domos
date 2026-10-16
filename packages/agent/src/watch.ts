import type { Context } from "@earendil-works/chord/context";
import type { CommitChange, Harness } from "@earendil-works/pi-durable";

export async function* watchCommits<T>(
  harness: Harness,
  accepts: (change: CommitChange) => boolean,
  read: () => Promise<T>,
  context: Context,
) {
  let pending = true;
  let closed = false;
  let previous: string | undefined;
  let changed = Promise.withResolvers<void>();
  const notify = () => {
    pending = true;
    changed.resolve();
  };
  const unsubscribe = harness.subscribeCommits(({ changes }) => {
    if (changes.some(accepts)) notify();
  });
  const unsubscribeClose = harness.subscribeClose(() => {
    closed = true;
    notify();
  });
  context.abortSignal?.addEventListener("abort", notify);
  try {
    while (!closed && !context.abortSignal?.aborted) {
      if (pending) {
        pending = false;
        const value = await read();
        const revision = JSON.stringify(value);
        if (revision !== previous) {
          previous = revision;
          yield value;
        }
      } else {
        await changed.promise;
        changed = Promise.withResolvers<void>();
      }
    }
    if (closed && !context.abortSignal?.aborted)
      throw new Error("服务连接已关闭。");
  } finally {
    unsubscribe();
    unsubscribeClose();
    context.abortSignal?.removeEventListener("abort", notify);
  }
}
