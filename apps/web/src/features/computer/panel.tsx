import { Button } from "@domos/ui/controls";
import { ChoicePicker } from "@domos/ui/picker";
import { SettingRow } from "@domos/ui/setting-row";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { useSettings } from "../settings/context.ts";
import { computerLabels } from "./copy.ts";
import type { useComputer } from "./use-computer.ts";

export function ComputerPanel({
  computer,
}: {
  computer: ReturnType<typeof useComputer>;
}) {
  const { status, busy, error, assign, choices } = computer;
  const settings = useSettings();
  return (
    <section className="detail-stack" aria-label="工作电脑" aria-busy={busy}>
      <div className="field">
        <span className="field-label">分配电脑</span>
        <ChoicePicker
          label="分配电脑"
          value={status?.id ?? ""}
          disabled={busy}
          onValueChange={(value) => void assign(value || null)}
          items={[
            { value: "", label: "暂不分配" },
            ...choices
              .filter((item) => item.authorized)
              .map((item) => ({ value: item.id, label: item.name })),
          ]}
        />
      </div>
      {status ? (
        <>
          <h3>{computerLabels.boundary[status.boundary]}</h3>
          <p className="detail-note">
            {computerLabels.state[status.state]} · {status.id}
          </p>
          <dl className="computer-facts">
            <dt>系统</dt>
            <dd>
              {status.os ? `${status.os} ${status.arch ?? ""}` : "连接后确认"}
            </dd>
            <dt>工作根目录</dt>
            <dd>{status.directory}</dd>
            <dt>网络</dt>
            <dd>{computerLabels.network[status.network]}</dd>
            <dt>服务部署</dt>
            <dd>
              {status.deployment === "container" ? "应用容器" : "原生进程"}
            </dd>
          </dl>
          <p className="detail-note">
            {status.boundary === "sandbox"
              ? "命令和工作文件在独立容器内执行。共享这台电脑的 Bot 共享文件和权限。停止或重建容器会中断全部 Bot 的进程，工作卷保留。"
              : "工具使用服务进程的系统权限。工作目录不是安全隔离边界。"}
          </p>
          {status.error && (
            <p className="alert" role="alert">
              {status.error}
            </p>
          )}
        </>
      ) : (
        <p className="detail-note" role="status">
          普通聊天不需要电脑。处理工作文件或执行命令时，请先分配电脑。
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="settings-card">
        <SettingRow title="电脑目录" description="添加电脑，管理连接与授权。">
          <Button
            variant="secondary"
            size="small"
            onClick={() => settings.open("computers")}
          >
            管理电脑
            <ArrowUpRightIcon size={14} />
          </Button>
        </SettingRow>
      </div>
    </section>
  );
}
