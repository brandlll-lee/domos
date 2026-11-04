import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { PanelRow } from "@domos/ui/panel";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../client.ts";

export function ProjectDirectory({
  botId,
  onSaved,
}: {
  botId: number;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [listing, setListing] =
    useState<Awaited<ReturnType<typeof client.computer.directories>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ path: string | null; id: string } | undefined>(
    undefined,
  );
  const browse = useCallback(
    async (path?: string) => {
      setBusy(true);
      setError("");
      try {
        const listing = await client.computer.directories({ botId, path });
        setPath(listing.path);
        setListing(listing);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "无法读取目录。");
      } finally {
        setBusy(false);
      }
    },
    [botId],
  );
  useEffect(() => {
    if (open) void browse();
  }, [browse, open]);
  async function save(directory: string | null) {
    setBusy(true);
    setError("");
    if (!request.current || request.current.path !== directory)
      request.current = { path: directory, id: crypto.randomUUID() };
    try {
      const binding = await client.computer.get({ botId });
      await client.computer.directory({
        botId,
        directory,
        revision: binding.revision,
        requestId: request.current.id,
      });
      await onSaved();
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "目录更改未确认。请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
      title="选择工作目录"
      description="选择这台电脑上的项目目录。原有文件会保留。更换目录后会使用新的模型会话。"
      trigger={
        <Button variant="secondary" size="small">
          更改目录
        </Button>
      }
      footer={
        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void save(null)}
          >
            使用个人目录
          </Button>
          <Button
            type="button"
            pending={busy}
            disabled={!path.trim()}
            onClick={() => void save(path)}
          >
            使用此目录
          </Button>
        </div>
      }
    >
      <form
        className="setup-form"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void browse(path);
        }}
      >
        <TextField
          label="目录路径"
          value={path}
          onValueChange={setPath}
          disabled={busy}
          required
        />
        <div className="form-actions">
          <Button
            type="submit"
            variant="secondary"
            disabled={busy || !path.trim()}
          >
            浏览目录
          </Button>
        </div>
        {listing && (
          <fieldset className="settings-group" disabled={busy}>
            {listing.parent !== listing.path && (
              <PanelRow
                icon={<FolderIcon />}
                title="上一级目录"
                onClick={() => void browse(listing.parent)}
              />
            )}
            {listing.items.map((item) => (
              <PanelRow
                key={item.path}
                icon={<FolderIcon />}
                title={item.name}
                onClick={() => void browse(item.path)}
              />
            ))}
            {listing.items.length === 0 && (
              <p className="detail-note">没有子目录。</p>
            )}
          </fieldset>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
