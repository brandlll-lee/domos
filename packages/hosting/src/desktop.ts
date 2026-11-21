import { z } from "zod";
import type { Sessions } from "./sessions.ts";

export const desktopIdentity = z
  .object({
    installationId: z.uuid(),
    currentToken: z.string().min(1).max(200).optional(),
  })
  .strict();
export type DesktopIdentity = z.infer<typeof desktopIdentity>;

export async function desktopSession(
  sessions: Sessions,
  directory: string,
  identity: DesktopIdentity,
) {
  const result = await sessions.desktop(
    identity.installationId,
    identity.currentToken,
  );
  await sessions.removeBootstrap(directory);
  return result;
}
