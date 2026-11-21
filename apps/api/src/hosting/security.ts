import type { Device, Sessions } from "@domos/hosting/sessions";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

export type HostingEnv = {
  Variables: { device: Device; accessOrigin: string };
};
const cookie = "domos_session";

export function sessionCookie(
  c: Context,
  token: string,
  expires: number,
  secure: boolean,
) {
  setCookie(c, cookie, token, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
    expires: new Date(expires),
  });
}

export function originGuard(
  addresses: string[],
): MiddlewareHandler<HostingEnv> {
  const origins = addresses.map((address) => new URL(address));
  return async (c, next) => {
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    const address = origins.find((address) => address.host === host);
    if (!address) return c.json({ error: "服务器地址不匹配。" }, 403);
    const origin = address.origin;
    const supplied = c.req.header("origin");
    if (supplied && supplied !== origin)
      return c.json({ error: "请求来源不匹配。" }, 403);
    if (c.req.header("sec-fetch-site") === "cross-site")
      return c.json({ error: "请从 Domos 页面操作。" }, 403);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
      !supplied &&
      !c.req.header("authorization")
    )
      return c.json({ error: "需要同源请求或设备凭据。" }, 403);
    c.set("accessOrigin", origin);
    await next();
  };
}

export function authenticate(
  sessions: Sessions,
): MiddlewareHandler<HostingEnv> {
  return async (c, next) => {
    const bearer = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1];
    const device = sessions.authenticate(bearer ?? getCookie(c, cookie) ?? "");
    if (!device) return c.json({ error: "请配对这台设备。" }, 401);
    c.set("device", device);
    await next();
  };
}

export const administrator: MiddlewareHandler<HostingEnv> = async (c, next) => {
  if (c.get("device").scope !== "admin")
    return c.json({ error: "需要管理员权限。" }, 403);
  await next();
};
