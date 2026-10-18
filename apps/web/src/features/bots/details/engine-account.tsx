import type { EngineId } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { useState } from "react";
import { OpenCodeAccount } from "./opencode-account.tsx";
import type { EngineSetup } from "./use-engine.ts";

export function EngineAccount({
  provider,
  botId,
  setup,
  canManage,
  onConnected,
}: {
  provider: EngineId;
  botId: number;
  setup: EngineSetup;
  canManage: boolean;
  onConnected: () => void;
}) {
  const [key, setKey] = useState("");
  const [method, setMethod] = useState("login");
  if (!canManage) return <p className="detail-note">请让管理员连接账号。</p>;
  if (setup.login?.state === "waiting") return <EngineSignIn setup={setup} />;
  return (
    <div className="engine-account">
      {provider === "opencode" ? (
        <OpenCodeAccount
          botId={botId}
          setup={setup}
          onConnected={onConnected}
        />
      ) : (
        <>
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
          {method === "login" ? (
            <Button
              disabled={setup.busy}
              pending={setup.pending === "login"}
              onClick={() => void setup.signIn()}
            >
              {provider === "claude" ? "登录 Claude" : "登录 Codex"}
            </Button>
          ) : (
            <form
              className="detail-stack"
              onSubmit={(event) => {
                event.preventDefault();
                const value = key;
                setKey("");
                void setup.key(value).then((success) => {
                  if (success) onConnected();
                });
              }}
            >
              <TextField
                label={
                  provider === "claude"
                    ? "Anthropic API 密钥"
                    : "OpenAI API 密钥"
                }
                type="password"
                autoComplete="off"
                value={key}
                onValueChange={setKey}
                disabled={setup.busy}
                description="密钥加密保存在此 Domos 服务中。"
              />
              <Button
                disabled={setup.busy || !key.trim()}
                pending={setup.pending === "key"}
              >
                连接
              </Button>
            </form>
          )}
        </>
      )}
      {setup.login?.state === "failed" && (
        <p className="alert" role="alert">
          登录未完成。请重试。
        </p>
      )}
    </div>
  );
}

function EngineSignIn({ setup }: { setup: EngineSetup }) {
  const [code, setCode] = useState("");
  return (
    <div className="engine-sign-in">
      <p role="status">{setup.login?.instructions || "在浏览器中完成登录。"}</p>
      {setup.login?.url ? (
        <a href={setup.login.url} target="_blank" rel="noreferrer">
          打开登录页面
        </a>
      ) : (
        <p role="status">正在取得登录地址…</p>
      )}
      {setup.login?.code && (
        <p>
          输入代码：<strong>{setup.login.code}</strong>
        </p>
      )}
      {setup.login?.prompt && (
        <form
          className="detail-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const value = code;
            setCode("");
            void setup.answerLogin(value);
          }}
        >
          <TextField
            label={setup.login.prompt}
            type="password"
            autoComplete="off"
            value={code}
            onValueChange={setCode}
            disabled={Boolean(setup.pending)}
          />
          <Button
            disabled={!code.trim() || Boolean(setup.pending)}
            pending={setup.pending === "answer"}
          >
            继续
          </Button>
        </form>
      )}
    </div>
  );
}
