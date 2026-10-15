import type { WatchHandle } from "@earendil-works/pi-durable";
import { ORPCError } from "@orpc/server";

export async function* watchValues<T>(
  watch: WatchHandle<T>,
  signal?: AbortSignal,
) {
  let pending: T | undefined = watch.value;
  let changed = Promise.withResolvers<void>();
  let closed = false;
  watch.start(async (value) => {
    pending = value;
    changed.resolve();
  });
  void watch.closed.then(() => {
    closed = true;
    changed.resolve();
  });
  try {
    while (!closed && !signal?.aborted) {
      if (pending !== undefined) {
        const value = pending;
        pending = undefined;
        yield value;
      } else {
        await changed.promise;
        changed = Promise.withResolvers<void>();
      }
    }
    if (!signal?.aborted) throw new ORPCError("SERVICE_UNAVAILABLE");
  } finally {
    await watch.stop();
  }
}
