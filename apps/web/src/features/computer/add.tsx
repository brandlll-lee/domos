import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { Disclosure } from "@domos/ui/disclosure";
import { TextField } from "@domos/ui/field";
import { ChoicePicker } from "@domos/ui/picker";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useState } from "react";
import { client } from "../../client.ts";

export function AddComputer({ onAdded }: { onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("容器环境");
  const [id, setId] = useState(() => `work-${crypto.randomUUID().slice(0, 8)}`);
  const [image, setImage] = useState("domos-workspace:3");
  const [network, setNetwork] = useState<"none" | "web" | "restricted">("none");
  const [proxyImage, setProxyImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const desktop = window.domosDesktop;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
      title="添加容器环境"
      description="在这台电脑上运行隔离容器。需要 Docker 和工作镜像。"
      trigger={
        <Button variant="secondary" size="small">
          <PlusIcon size={14} />
          添加容器环境
        </Button>
      }
      footer={
        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            取消
          </Button>
          <Button type="submit" form="add-computer" pending={busy}>
            {busy ? "正在添加…" : "添加环境"}
          </Button>
        </div>
      }
    >
      <form
        id="add-computer"
        className="setup-form"
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
                network,
                ...(network === "web" ? { proxyImage } : {}),
                cpus: 2,
                memoryMiB: 1024,
                pids: 256,
                timeoutSeconds: 120,
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
        {desktop && (
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await desktop.prepare();
                  if (!result.ok || !result.value)
                    throw new Error(result.error);
                  setImage(result.value.image);
                  if (result.value.proxyImage) {
                    setProxyImage(result.value.proxyImage);
                    setNetwork("web");
                  }
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
          </div>
        )}
        <fieldset className="setup-form" disabled={busy}>
          <TextField
            label="环境名称"
            value={name}
            maxLength={80}
            required
            onValueChange={setName}
          />
          <Disclosure label="高级设置">
            <div className="setup-form">
              <TextField
                label="环境标识"
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
                <span className="field-label">网络策略</span>
                <ChoicePicker
                  label="网络策略"
                  value={network}
                  onValueChange={(value) => setNetwork(value as typeof network)}
                  items={[
                    { value: "none", label: "关闭外部网络" },
                    { value: "web", label: "允许 HTTP(S) 网站" },
                    { value: "restricted", label: "受限公网出网" },
                  ]}
                />
              </div>
              {network === "web" && (
                <TextField
                  label="代理镜像"
                  value={proxyImage}
                  required
                  onValueChange={setProxyImage}
                />
              )}
              {network === "restricted" && (
                <p className="detail-note">
                  Docker 主机需要安装 Domos 出网防火墙规则。
                </p>
              )}
            </div>
          </Disclosure>
        </fieldset>
        {error && <p role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
