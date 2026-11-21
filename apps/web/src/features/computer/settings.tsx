import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { PanelCard, PanelRow } from "@domos/ui/panel";
import { SettingRow } from "@domos/ui/setting-row";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../client.ts";
import { Devices } from "../hosting/devices.tsx";
import { useErrorNotice } from "../notices.tsx";
import { AddComputer } from "./add.tsx";
import { ComputerAccess, ComputerRecord } from "./record.tsx";

export function ComputerSettings({
  admin,
  deviceId,
  page,
  onPageChange,
}: {
  admin: boolean;
  deviceId?: string;
  page?: string;
  onPageChange: (page?: string) => void;
}) {
  const nameTrigger = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [catalog, setCatalog] =
    useState<Awaited<ReturnType<typeof client.computer.list>>>();
  const [node, setNode] =
    useState<Awaited<ReturnType<typeof client.computer.node>>>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [bots, setBots] = useState<
    Awaited<ReturnType<typeof client.bots.list>>
  >([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const [catalog, bots, node] = await Promise.all([
      client.computer.list(),
      client.bots.list(),
      client.computer.node(),
    ]);
    setCatalog(catalog);
    setBots(bots);
    setNode(node);
    setName(node.name);
  }, []);
  useEffect(() => {
    void refresh().catch((cause) => setError(cause.message));
  }, [refresh]);
  async function run(action?: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action?.();
      await refresh();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "操作未确认。请刷新状态。",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  const owner = catalog?.items.find((item) => item.kind === "process");
  useErrorNotice(error, async () => {
    await run();
  });
  const containers =
    catalog?.items.filter((item) => item.kind !== "process") ?? [];
  return (
    <section className="settings-sections" aria-label="电脑" aria-busy={busy}>
      {!catalog && !error && <Loading label="正在读取电脑" />}
      {!page && node && (
        <PanelCard>
          <SettingRow
            title={node.name}
            description={`已连接 · ${bots.length} 个 Bot`}
          >
            {admin && (
              <Button
                ref={nameTrigger}
                variant="ghost"
                size="icon-small"
                aria-label="编辑电脑名称"
                onClick={() => {
                  setName(node.name);
                  setEditing(true);
                }}
              >
                <PencilSimpleIcon />
              </Button>
            )}
          </SettingRow>
          {admin && owner && (
            <ComputerAccess
              item={owner}
              admin={admin}
              busy={busy}
              error={error}
              bots={bots
                .filter(
                  (bot) =>
                    catalog?.bindings[String(bot.id)]?.computerId === owner.id,
                )
                .map((bot) => bot.name)}
              run={run}
            />
          )}
        </PanelCard>
      )}
      {admin && deviceId && (
        <div hidden={page === "environments"}>
          <Devices
            current={deviceId}
            open={page === "devices"}
            onOpen={() => onPageChange("devices")}
          />
        </div>
      )}
      {catalog && (
        <div hidden={Boolean(page)}>
          <PanelCard>
            <PanelRow
              icon={<DesktopIcon />}
              title="工作环境"
              value={`${containers.length} 个容器`}
              onClick={() => onPageChange("environments")}
            />
          </PanelCard>
        </div>
      )}
      {page === "environments" && (
        <>
          <div className="form-actions">
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="刷新电脑状态"
              pending={busy}
              onClick={() => void run()}
            >
              <ArrowClockwiseIcon />
            </Button>
            {admin && <AddComputer onAdded={refresh} />}
          </div>
          {containers.length ? (
            <PanelCard>
              {containers.map((item) => (
                <ComputerRecord
                  key={item.id}
                  item={item}
                  admin={admin}
                  busy={busy}
                  error={error}
                  bots={bots
                    .filter(
                      (bot) =>
                        catalog?.bindings[String(bot.id)]?.computerId ===
                        item.id,
                    )
                    .map((bot) => bot.name)}
                  run={run}
                />
              ))}
            </PanelCard>
          ) : (
            catalog && <p className="detail-note">还没有容器环境。</p>
          )}
        </>
      )}
      <Dialog
        open={editing}
        finalFocus={() => nameTrigger.current}
        onOpenChange={(open) => {
          if (!busy) setEditing(open);
        }}
        title="电脑名称"
        footer={
          <div className="dialog-actions">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              取消
            </Button>
            <Button
              form="computer-name"
              type="submit"
              pending={busy}
              disabled={!name.trim()}
            >
              保存
            </Button>
          </div>
        }
      >
        <form
          id="computer-name"
          className="setup-form"
          aria-busy={busy}
          onSubmit={async (event) => {
            event.preventDefault();
            if (await run(() => client.computer.rename({ name })))
              setEditing(false);
          }}
        >
          <TextField
            label="电脑名称"
            value={name}
            maxLength={80}
            required
            disabled={busy}
            onValueChange={setName}
          />
        </form>
      </Dialog>
    </section>
  );
}
