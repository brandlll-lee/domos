import { z } from "zod";

export const instanceSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(80),
    mode: z.enum(["local", "existing"]),
    url: z.url(),
  })
  .strict();
export type Instance = z.infer<typeof instanceSchema>;

export function serverOrigin(input: string) {
  const url = new URL(input.includes("://") ? input : `https://${input}`);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  )
    throw new Error("远程连接需要 HTTPS；本机可以使用 HTTP。");
  return url.origin;
}

export async function probeInstance(input: string, signal?: AbortSignal) {
  const origin = serverOrigin(input);
  const response = await fetch(new URL("/hosting/info", origin), {
    signal: signal ?? AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("无法连接 Domos。");
  const info = z
    .object({ product: z.literal("domos"), version: z.string() })
    .parse(await response.json());
  return { origin, ...info };
}
