import type { Sessions } from "./sessions.ts";

export async function desktopSession(sessions: Sessions, directory: string) {
  const result = sessions.exchange(
    sessions.pairing("admin").code,
    "Domos 桌面",
  );
  if (!result) throw new Error("桌面连接未完成。");
  await sessions.removeBootstrap(directory);
  return { token: result.token, expires: result.device.expires };
}
