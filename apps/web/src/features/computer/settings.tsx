import { Button } from "@domos/ui/controls";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { AddComputer } from "./add.tsx";
import { ComputerRecord } from "./record.tsx";

export function ComputerSettings({ admin }: { admin: boolean }) {
  const [catalog, setCatalog] =
    useState<Awaited<ReturnType<typeof client.computer.list>>>();
  const [busy, setBusy] = useState(false);
  const [bots, setBots] = useState<
    Awaited<ReturnType<typeof client.bots.list>>
  >([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const [catalog, bots] = await Promise.all([
      client.computer.list(),
      client.bots.list(),
    ]);
    setCatalog(catalog);
    setBots(bots);
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
  return (
    <section className="settings-group" aria-label="工作电脑" aria-busy={busy}>
      <div className="section-heading">
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
      </div>
      {catalog?.items.map((item) => (
        <ComputerRecord
          key={item.id}
          item={item}
          admin={admin}
          busy={busy}
          error={error}
          bots={bots
            .filter(
              (bot) => catalog.bindings[String(bot.id)]?.computerId === item.id,
            )
            .map((bot) => bot.name)}
          run={run}
        />
      ))}
      {catalog?.items.length === 0 && <p role="status">还没有工作电脑。</p>}
      {admin && catalog && (
        <SettingRow title="新机器人使用" description="只影响新建机器人。">
          <ChoicePicker
            label="新机器人使用"
            value={catalog.defaultId ?? ""}
            disabled={busy}
            onValueChange={(id) =>
              void run(() => client.computer.default({ id: id || null }))
            }
            items={[
              { value: "", label: "不分配电脑" },
              ...catalog.items
                .filter(
                  (item) => item.authorized && item.scope?.kind !== "dedicated",
                )
                .map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </SettingRow>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
