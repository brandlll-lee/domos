import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { ChoicePicker } from "@domos/ui/picker";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useState } from "react";
import { client } from "../../client.ts";

export function AddComputer({ onAdded }: { onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("工作电脑");
  const [id, setId] = useState(() => `work-${crypto.randomUUID().slice(0, 8)}`);
  const [image, setImage] = useState("domos-workspace:2");
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
      trigger={
        <Button variant="secondary" size="small">
          <PlusIcon size={14} />
          添加 Docker 电脑
        </Button>
      }
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
          <TextField
            label="电脑名称"
            value={name}
            maxLength={80}
            required
            onValueChange={setName}
          />
          <TextField
            label="电脑标识"
            value={id}
            pattern="[a-z0-9][a-z0-9_.-]{0,62}"
            required
            onValueChange={setId}
          />
          <TextField
            label="工作镜像"
            value={image}
            required
            onValueChange={setImage}
          />
          <div className="field">
            <span className="field-label">Docker 位置</span>
            <ChoicePicker
              label="Docker 位置"
              value={remote ? "remote" : "local"}
              onValueChange={(value) => setRemote(value === "remote")}
              items={[
                { value: "local", label: "本地 Docker" },
                { value: "remote", label: "远程 Docker" },
              ]}
            />
          </div>
          {remote && (
            <>
              <TextField
                label="SSH 主机"
                value={host}
                required
                onValueChange={setHost}
              />
              <TextField
                label="SSH 用户"
                value={user}
                onValueChange={setUser}
              />
              <TextField
                label="主机密钥文件路径"
                value={knownHostsFile}
                required
                onValueChange={setKnownHostsFile}
              />
              <TextField
                label="身份文件路径"
                value={identityFile}
                onValueChange={setIdentityFile}
              />
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
