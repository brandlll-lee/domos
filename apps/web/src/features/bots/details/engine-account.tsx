import type { EngineId } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { SettingRow } from "@domos/ui/setting-row";
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
  return (
    <div className="engine-account">
      <SettingRow
        title="账号"
        description={
          setup.connection?.authenticated ? "已连接" : "连接后即可开始工作。"
        }
      >
        {canManage && provider === "codex" && (
          <Button
            size="small"
            variant="secondary"
            disabled={setup.busy}
            pending={setup.pending === "login"}
            onClick={() => void setup.signIn()}
          >
            {setup.pending === "login"
              ? "正在连接…"
              : setup.connection?.authenticated
                ? "重新登录 Codex"
                : "登录 Codex"}
          </Button>
        )}
      </SettingRow>
      {canManage ? (
        <>
          <details
            className="engine-account-options"
            open={provider !== "codex" || undefined}
          >
            <summary>
              {provider === "codex" ? "使用 API 密钥" : "连接 API 密钥"}
            </summary>
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
              <div className="form-actions">
                <Button
                  size="small"
                  disabled={setup.busy || !key.trim()}
                  pending={setup.pending === "key"}
                >
                  {setup.pending === "key" ? "正在连接…" : "连接"}
                </Button>
                {setup.connection?.authenticated && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    disabled={setup.busy}
                    onClick={() => void setup.key(null)}
                  >
                    移除密钥
                  </Button>
                )}
              </div>
            </form>
          </details>
          {setup.login?.state === "waiting" && (
            <div className="detail-stack engine-sign-in" role="status">
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
              <div className="form-actions">
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => void setup.cancel()}
                >
                  取消登录
                </Button>
              </div>
            </div>
          )}
          {setup.login?.state === "failed" && (
            <p className="alert" role="alert">
              登录未完成。请重试，或连接密钥。
            </p>
          )}
        </>
      ) : (
        <p className="detail-note">请让管理员连接账号。</p>
      )}
    </div>
  );
}
