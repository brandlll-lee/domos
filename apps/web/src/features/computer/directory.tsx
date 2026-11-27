import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { useEffect, useRef, useState } from "react";
import { client } from "../../client.ts";
import { type DirectoryListing, DirectoryPicker } from "./directory-picker.tsx";

export function ProjectDirectory({
  botId,
  onSaved,
}: {
  botId: number;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<DirectoryListing>();
  const [binding, setBinding] =
    useState<Awaited<ReturnType<typeof client.computer.get>>>();
  const [name, setName] = useState("");
  const [personal, setPersonal] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ path: string | null; id: string } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([
      client.computer.directories({ botId }),
      client.computer.get({ botId }),
      client.work.profile({ botId }),
    ])
      .then(
        ([listing, binding, profile]) => {
          if (!active) return;
          setListing(listing);
          setBinding(binding);
          setName(profile.name);
          setPersonal(binding.directory === null ? listing.path : undefined);
        },
        (cause) => {
          if (active)
            setError(cause instanceof Error ? cause.message : "无法读取目录。");
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [botId, open]);
  async function browse(path: string) {
    if (loading || saving) return;
    setLoading(true);
    setError("");
    try {
      setListing(await client.computer.directories({ botId, path }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取目录。");
    } finally {
      setLoading(false);
    }
  }
  async function save(directory: string | null) {
    if (!binding || saving || loading) return;
    setSaving(true);
    setError("");
    if (!request.current || request.current.path !== directory)
      request.current = {
        path: directory,
        id: crypto.randomUUID(),
      };
    try {
      const current = await client.computer.get({ botId });
      await client.computer.directory({
        botId,
        directory,
        revision: current.revision,
        requestId: request.current.id,
      });
      await onSaved();
      request.current = undefined;
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "目录更改未确认。请重试。",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <Button variant="secondary" size="small" onClick={() => setOpen(true)}>
        更改目录
      </Button>
      {open &&
        (listing && binding ? (
          <DirectoryPicker
            botName={name}
            computerName={binding.computer?.name ?? "工作电脑"}
            personalDirectory={personal}
            currentDirectory={binding.directory}
            listing={listing}
            loading={loading}
            saving={saving}
            error={error}
            onBrowse={(path) => void browse(path)}
            onChoose={(path) => void save(path)}
            onClose={() => {
              if (!saving) setOpen(false);
            }}
          />
        ) : (
          <Dialog open title="工作文件夹" layout="task" onOpenChange={setOpen}>
            {loading ? (
              <Loading label="正在读取文件夹" />
            ) : (
              <InlineNotice>{error}</InlineNotice>
            )}
          </Dialog>
        ))}
    </>
  );
}
