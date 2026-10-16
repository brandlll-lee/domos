import type { Bots } from "@domos/agent/bots";
import type { Computers } from "@domos/agent/computer/catalog";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";

export async function* watchDirectory(
  bots: Bots,
  computer?: Computers,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const contacts = bots.watch(
    withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
  );
  const states = computer?.watch(controller.signal, BACKGROUND_CONTEXT);
  const failure = (error: unknown) => ({ kind: "error" as const, error });
  const readContacts = () =>
    contacts
      .next()
      .then((value) => ({ kind: "contacts" as const, value }), failure);
  const readComputer = () =>
    states
      ?.next()
      .then((value) => ({ kind: "computer" as const, value }), failure);
  let nextContacts = readContacts();
  let nextComputer = readComputer();
  let items: Awaited<ReturnType<Bots["list"]>> | undefined;
  let status: Awaited<ReturnType<Computers["list"]>> | null = null;
  try {
    while (!controller.signal.aborted) {
      const next = await Promise.race(
        nextComputer ? [nextContacts, nextComputer] : [nextContacts],
      );
      if (next.kind === "error") throw next.error;
      if (next.value.done) break;
      if (next.kind === "contacts") {
        items = next.value.value;
        nextContacts = readContacts();
      } else {
        status = next.value.value;
        nextComputer = readComputer();
      }
      if (items)
        yield {
          items,
          computers: status?.items ?? [],
          defaultComputerId: status?.defaultId ?? null,
          bindings: status?.bindings ?? {},
        };
    }
  } finally {
    controller.abort();
    signal?.removeEventListener("abort", abort);
    await Promise.allSettled([
      nextContacts,
      nextComputer,
      contacts.return(),
      states?.return(),
    ]);
  }
}
