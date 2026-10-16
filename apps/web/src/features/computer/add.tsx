import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { useState } from "react";
import { client } from "../../client.ts";

export function AddComputer({ onAdded }: { onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("工作电脑");
  const [id, setId] = useState(() => `work-${crypto.randomUUID().slice(0, 8)}`);
  const [image, setImage] = useState("domos-workspace:1.2.0");
  const [prepared, setPrepared] = useState<{
    image: string;
    proxyImage?: string;
  }>();
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [knownHostsFile, setKnownHostsFile] = useState("");
  const [identityFile, setIdentityFile] = useState("");
  const [remote, setRemote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const desktop = window.domosDesktop;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
      title="添加 Docker 电脑"
      description="连接已准备好工作环境的 Docker 主机。"
      trigger={<Button variant="secondary">添加 Docker 电脑</Button>}
    >
      <form
        className="hosting-stack"
        aria-busy={busy}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await client.computer.add({
              name,
              config: {
                kind: "docker",
                id,
                image,
                volume: `domos-${id}-work`,
                network:
                  !remote && prepared?.image === image && prepared.proxyImage
                    ? "web"
                    : "none",
                ...(!remote && prepared?.image === image && prepared.proxyImage
                  ? { proxyImage: prepared.proxyImage }
                  : {}),
                cpus: 2,
                memoryMiB: 1024,
                pids: 256,
                timeoutSeconds: 120,
                ...(remote
                  ? {
                      ssh: {
                        host,
                        knownHostsFile,
                        hostKeyAlias: id,
                        ...(user ? { user } : {}),
                        ...(identityFile ? { identityFile } : {}),
                      },
                    }
                  : {}),
              },
            });
            await onAdded();
            setOpen(false);
            setId(`work-${crypto.randomUUID().slice(0, 8)}`);
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : "电脑添加未确认。",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="detail-note">
          使用已准备 Pi 工作镜像的 Docker 主机。远程电脑通过 SSH
          接入。容器默认关闭网络。
        </p>
        {!remote && desktop && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await desktop.prepare();
                if (!result.ok || !result.value) throw new Error(result.error);
                setPrepared(result.value);
                setImage(result.value.image);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Docker 准备未完成。",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            准备本地 Docker 镜像
          </Button>
        )}
        <fieldset className="bot-fields hosting-stack" disabled={busy}>
          <label>
            电脑名称
            <input
              value={name}
              maxLength={80}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            电脑标识
            <input
              value={id}
              pattern="[a-z0-9][a-z0-9_.-]{0,62}"
              required
              onChange={(event) => setId(event.target.value)}
            />
          </label>
          <label>
            工作镜像
            <input
              value={image}
              required
              onChange={(event) => setImage(event.target.value)}
            />
          </label>
          <label>
            Docker 位置
            <select
              value={remote ? "remote" : "local"}
              onChange={(event) => setRemote(event.target.value === "remote")}
            >
              <option value="local">本地 Docker</option>
              <option value="remote">远程 Docker</option>
            </select>
          </label>
          {remote && (
            <>
              <label>
                SSH 主机
                <input
                  value={host}
                  required
                  onChange={(event) => setHost(event.target.value)}
                />
              </label>
              <label>
                SSH 用户
                <input
                  value={user}
                  onChange={(event) => setUser(event.target.value)}
                />
              </label>
              <label>
                主机密钥文件路径
                <input
                  value={knownHostsFile}
                  required
                  onChange={(event) => setKnownHostsFile(event.target.value)}
                />
              </label>
              <label>
                身份文件路径
                <input
                  value={identityFile}
                  onChange={(event) => setIdentityFile(event.target.value)}
                />
              </label>
            </>
          )}
        </fieldset>
        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            取消
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "正在添加…" : "添加电脑"}
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
