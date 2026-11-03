import { useEffect, useRef, useState } from "react";
import { client } from "../../../client.ts";
import { userError } from "../../user-error.ts";

export type WorkData = Awaited<ReturnType<typeof client.work.get>>;
export type Profile = Awaited<ReturnType<typeof client.work.profile>>;
type IdentityDraft = Pick<Profile, "name" | "instructions" | "avatar">;
export type WorkAction = ReturnType<typeof useWorkAction>;

export function useWorkAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ key: string; id: string } | null>(null);
  const active = useRef(false);
  async function run<T>(
    key: unknown,
    action: (requestId: string) => Promise<T>,
    onSuccess?: (value: T) => void,
  ) {
    if (active.current) return;
    const payload = JSON.stringify(key);
    if (request.current?.key !== payload)
      request.current = { key: payload, id: crypto.randomUUID() };
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await action(request.current.id);
      request.current = null;
      onSuccess?.(value);
    } catch (cause) {
      setError(userError(cause, "请求未确认。请重试，系统会核对原请求。"));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run, clear: () => setError(null) };
}

const retained = new Map<
  number,
  { data: WorkData | null; profile: Profile | null; draft?: IdentityDraft }
>();
export function useIdentityDraft(profile: Profile) {
  const [draft, update] = useState<IdentityDraft>(
    () =>
      retained.get(profile.id)?.draft ?? {
        name: profile.name,
        instructions: profile.instructions,
        avatar: profile.avatar,
      },
  );
  const change = (patch: Partial<IdentityDraft>) =>
    update((current) => {
      const next = { ...current, ...patch };
      const state = retained.get(profile.id);
      if (state) state.draft = next;
      return next;
    });
  return { ...draft, change };
}
export function clearBotWork(ids?: Set<number>) {
  for (const id of retained.keys()) if (!ids?.has(id)) retained.delete(id);
}
window.addEventListener("domos:pair", () => retained.clear());
export function useBotWork(
  botId: number,
  active: boolean,
  live: boolean,
  profileActive: boolean,
) {
  const [saved] = useState(
    () => retained.get(botId) ?? { data: null, profile: null },
  );
  retained.set(botId, saved);
  const [data, setData] = useState<WorkData | null>(saved.data);
  const [profile, setProfile] = useState<Profile | null>(saved.profile);
  saved.data = data;
  saved.profile = profile;
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  useEffect(() => {
    if (!profileActive) return;
    const controller = new AbortController();
    setProfileError(null);
    void client.work
      .profile({ botId }, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setProfile(value);
          setProfileError(null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setProfileError("资料加载失败。请关闭后重试。");
      });
    return () => controller.abort();
  }, [botId, profileActive]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setError(null);
    void (async () => {
      try {
        if (!live) {
          const value = await client.work.get(
            { botId },
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) {
            setData(value);
          }
          return;
        }
        const events = await client.work.subscribe(
          { botId },
          {
            signal: controller.signal,
            context: {
              retry: Number.POSITIVE_INFINITY,
              onRetry: () => {
                if (!controller.signal.aborted)
                  setError("详情连接中断，正在重连。");
              },
            },
          },
        );
        for await (const value of events) {
          if (controller.signal.aborted) return;
          setData(value);
          setError(null);
        }
      } catch {
        if (!controller.signal.aborted)
          setError("详情连接中断。请关闭后重试。");
      }
    })();
    return () => controller.abort();
  }, [botId, active, live]);
  return { data, profile, setProfile, error, profileError };
}
