import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { TextField } from "@domos/ui/field";
import { SettingRow } from "@domos/ui/setting-row";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { useErrorNotice } from "../notices.tsx";
import { AddComputer } from "./add.tsx";
import { ComputerAccess, ComputerRecord } from "./record.tsx";

export function ComputerSettings({ admin }: { admin: boolean }) {
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
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
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
    await run(refresh);
  });
  const containers =
    catalog?.items.filter((item) => item.kind !== "process") ?? [];
  return (
    <section className="settings-group" aria-label="电脑" aria-busy={busy}>
      {node && (
        <>
          <div>
            <form
              className="setup-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy && name.trim())
                  void run(() => client.computer.rename({ name }));
              }}
            >
              <TextField
                label="电脑名称"
                value={name}
                maxLength={80}
                required
                disabled={!admin || busy}
                onValueChange={setName}
              />
              {admin && name.trim() !== node.name && (
                <div className="form-actions">
                  <Button type="submit" size="small" disabled={busy}>
                    保存
                  </Button>
                </div>
              )}
            </form>
          </div>
          <SettingRow title="连接状态">
            已连接 · {bots.length} 个机器人
          </SettingRow>
        </>
      )}
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
      <Disclosure label="高级设置">
        <div className="settings-group">
          <div className="form-actions">
            <Button
              variant="secondary"
              size="icon-small"
              aria-label="刷新电脑状态"
              title="刷新电脑状态"
              disabled={busy}
              onClick={() => void run(refresh)}
            >
              <ArrowClockwiseIcon size={16} />
            </Button>
            {admin && <AddComputer onAdded={refresh} />}
          </div>
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
                    catalog?.bindings[String(bot.id)]?.computerId === item.id,
                )
                .map((bot) => bot.name)}
              run={run}
            />
          ))}
          {containers.length === 0 && (
            <p className="detail-note">还没有容器环境。</p>
          )}
        </div>
      </Disclosure>
    </section>
  );
}
