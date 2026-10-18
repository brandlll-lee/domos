import type { EngineId } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { useState } from "react";
import type { EngineSetup } from "./use-engine.ts";

export function EngineAccount({
  provider,
  setup,
  canManage,
}: {
  provider: EngineId;
  setup: EngineSetup;
  canManage: boolean;
}) {
  const [key, setKey] = useState("");
  const [method, setMethod] = useState(provider === "codex" ? "login" : "key");
  if (!canManage) return <p className="detail-note">请让管理员连接账号。</p>;
  if (setup.login?.state === "waiting")
    return (
      <div className="engine-sign-in" role="status">
        <p>在浏览器中完成登录。</p>
        {setup.login.url ? (
          <a href={setup.login.url} target="_blank" rel="noreferrer">
            打开登录页面
          </a>
        ) : (
          <p>正在取得登录地址…</p>
        )}
        {setup.login.code && (
          <p>
            输入代码：<strong>{setup.login.code}</strong>
          </p>
        )}
      </div>
    );
  return (
    <div className="engine-account">
      {provider === "codex" && (
        <div className="engine-auth-methods">
          <Button
            variant={method === "login" ? "secondary" : "ghost"}
            size="small"
            disabled={setup.busy}
            aria-pressed={method === "login"}
            onClick={() => setMethod("login")}
          >
            账号登录
          </Button>
          <Button
            variant={method === "key" ? "secondary" : "ghost"}
            size="small"
            disabled={setup.busy}
            aria-pressed={method === "key"}
            onClick={() => setMethod("key")}
          >
            使用 API 密钥
          </Button>
        </div>
      )}
      {method === "login" ? (
        <Button
          disabled={setup.busy}
          pending={setup.pending === "login"}
          onClick={() => void setup.signIn()}
        >
          登录 Codex
        </Button>
      ) : (
        <form
          className="detail-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const value = key;
            setKey("");
            void setup.key(value);
          }}
        >
          <TextField
            label={
              provider === "claude" ? "Anthropic API 密钥" : "OpenAI API 密钥"
            }
            type="password"
            autoComplete="off"
            value={key}
            onValueChange={setKey}
            disabled={setup.busy}
            description="密钥加密保存在此 Domos 服务中。"
          />
          <div className="form-actions">
            <Button
              disabled={setup.busy || !key.trim()}
              pending={setup.pending === "key"}
            >
              连接
            </Button>
            {setup.connection?.authenticated && (
              <Button
                type="button"
                variant="ghost"
                disabled={setup.busy}
                onClick={() => void setup.key(null)}
              >
                移除密钥
              </Button>
            )}
          </div>
        </form>
      )}
      {setup.login?.state === "failed" && (
        <p className="alert" role="alert">
          登录未完成。请重试，或连接密钥。
        </p>
      )}
    </div>
  );
}
