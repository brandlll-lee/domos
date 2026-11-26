import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { useEffect, useState } from "react";
import { client } from "../../client.ts";

type Connection = Awaited<ReturnType<typeof client.mcp.list>>[number];

export function ConnectionLogin({
  item,
  busy,
  run,
}: {
  item: Connection;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [loginOpen, setLoginOpen] = useState(
    item.status === "authorization_required" || item.authorizationPending,
  );
  useEffect(() => {
    if (item.status === "authorization_required" || item.authorizationPending)
      setLoginOpen(true);
  }, [item.status, item.authorizationPending]);
  const [oauthClient, setOauthClient] = useState("");
  const [oauthSecret, setOauthSecret] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  return (
    <Disclosure
      open={loginOpen}
      onToggle={(event) => setLoginOpen(event.currentTarget.open)}
      label="登录与凭据"
    >
      <div className="apps-actions">
        <Button
          variant="secondary"
          disabled={busy || !item.enabled}
          onClick={() =>
            void run(async () => {
              const login = await client.mcp.login({
                id: item.id,
                client: oauthClient
                  ? {
                      client_id: oauthClient,
                      client_secret: oauthSecret || undefined,
                    }
                  : undefined,
              });
              setOauthSecret("");
              if (login.url) {
                setAuthorizationUrl(login.url);
                window.open(login.url, "_blank", "noopener,noreferrer");
              }
            })
          }
        >
          浏览器登录
        </Button>
        {item.authorizationPending && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await client.mcp.logout({
                  id: item.id,
                  cancel: true,
                });
                setAuthorizationUrl(null);
              })
            }
          >
            取消登录
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void run(() => client.mcp.logout({ id: item.id }))}
        >
          退出登录
        </Button>
      </div>
      {item.authorizationPending && authorizationUrl && (
        <a href={authorizationUrl} target="_blank" rel="noreferrer">
          继续浏览器授权
        </a>
      )}
      <Disclosure label="自定义 OAuth 客户端">
        <div className="form-fields">
          <label className="field">
            <span className="field-label">客户端编号</span>
            <input
              className="field-control"
              value={oauthClient}
              onChange={(e) => setOauthClient(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">客户端密钥</span>
            <input
              type="password"
              className="field-control"
              autoComplete="new-password"
              value={oauthSecret}
              onChange={(e) => setOauthSecret(e.target.value)}
            />
          </label>
        </div>
      </Disclosure>
    </Disclosure>
  );
}
