import { Button } from "@domos/ui/controls";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { useCallback, useEffect, useState } from "react";
import { client } from "../../client.ts";
import { AddComputer } from "./add.tsx";
import { ComputerRecord } from "./record.tsx";

export function ComputerSettings({ admin }: { admin: boolean }) {
  const [catalog, setCatalog] =
    useState<Awaited<ReturnType<typeof client.computer.list>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(
    async () => setCatalog(await client.computer.list()),
    [],
  );
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
    <section className="settings-group" aria-label="电脑管理" aria-busy={busy}>
      <div className="section-heading">
        <strong>工作电脑</strong>
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
      <p className="detail-note">
        普通聊天不需要电脑。多个 Bot 可共用一台电脑。共享电脑上的 Bot
        共享文件和系统权限。
      </p>
      {catalog?.items.map((item) => (
        <ComputerRecord
          key={item.id}
          item={item}
          admin={admin}
          busy={busy}
          error={error}
          defaultId={catalog.defaultId}
          run={run}
        />
      ))}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
