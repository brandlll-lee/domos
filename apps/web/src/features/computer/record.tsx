import type { ComputerView } from "@domos/agent/computer/catalog";
import { Button, Switch } from "@domos/ui/controls";
import { SettingRow } from "@domos/ui/setting-row";
import { client } from "../../client.ts";
import { computerLabels } from "./copy.ts";
import { ComputerDetails, ConfirmComputerAction } from "./dialogs.tsx";

type RecordProps = {
  item: ComputerView;
  admin: boolean;
  busy: boolean;
  error: string;
  defaultId: string | null;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
};

export function ComputerRecord(props: RecordProps) {
  const { item, admin, busy, defaultId, run } = props;
  return (
    <section className="settings-card" aria-label={item.name}>
      <SettingRow
        title={item.name}
        description={`${computerLabels.boundary[item.boundary]} · ${computerLabels.state[item.state]} · ${item.authorized ? "已授权" : "待授权"}`}
      >
        <ComputerDetails name={item.name}>
          <dl className="computer-facts">
            <dt>工作根目录</dt>
            <dd>{item.directory}</dd>
            <dt>能力</dt>
            <dd>
              {item.capabilities.commands ? "命令与文件" : "当前不可执行"}
            </dd>
            <dt>网络</dt>
            <dd>{computerLabels.network[item.network]}</dd>
          </dl>
        </ComputerDetails>
      </SettingRow>
      {item.error && (
        <p className="alert" role="alert">
          {item.error}
        </p>
      )}
      {admin && <ComputerAccess {...props} />}
      {admin && item.authorized && (
        <SettingRow
          title="默认电脑"
          description="新建 Bot 时自动分配。已有 Bot 的归属保持不变。"
        >
          <Switch
            label={`新 Bot 默认使用${item.name}`}
            checked={defaultId === item.id}
            disabled={busy}
            onCheckedChange={(checked) =>
              void run(() =>
                client.computer.default({ id: checked ? item.id : null }),
              )
            }
          />
        </SettingRow>
      )}
      {admin && item.authorized && item.kind !== "process" && (
        <ContainerSettings {...props} />
      )}
    </section>
  );
}

function ComputerAccess({ item, busy, error, run }: RecordProps) {
  return (
    <SettingRow
      title="工具访问"
      description={
        item.kind === "process"
          ? "允许 Bot 使用本机命令与文件。工具使用服务进程的系统权限。"
          : "允许已分配的 Bot 使用此电脑的命令与文件。"
      }
    >
      {item.authorized ? (
        <Button
          variant="secondary"
          size="small"
          disabled={busy}
          onClick={() =>
            void run(() =>
              client.computer.authorize({ id: item.id, authorized: false }),
            )
          }
        >
          撤销授权
        </Button>
      ) : (
        <ConfirmComputerAction
          title={`授权使用${item.name}`}
          description="命令和文件工具使用服务进程的系统权限。工作目录不提供安全隔离。仅在信任 Bot 的任务时授权。"
          label="确认授权"
          variant="primary"
          busy={busy}
          error={error}
          onConfirm={() =>
            run(() =>
              client.computer.authorize({ id: item.id, authorized: true }),
            )
          }
        />
      )}
    </SettingRow>
  );
}

function ContainerSettings({ item, busy, error, run }: RecordProps) {
  const running = item.state === "running";
  return (
    <>
      <SettingRow
        title="容器运行"
        description="停止后，此电脑上的 Bot 将无法使用工具。"
      >
        <Button
          variant="secondary"
          size="small"
          disabled={busy}
          onClick={() =>
            void run(() =>
              client.computer.manage({
                id: item.id,
                action: running ? "stop" : "start",
              }),
            )
          }
        >
          {running ? "停止电脑" : "启动电脑"}
        </Button>
      </SettingRow>
      <SettingRow
        title="重建容器"
        description="保留工作卷，并结束容器内的进程。"
      >
        <ConfirmComputerAction
          title="重建工作容器"
          label="确认重建"
          description="工作卷保留。容器内的进程将结束。"
          busy={busy}
          error={error}
          onConfirm={() =>
            run(() =>
              client.computer.manage({ id: item.id, action: "rebuild" }),
            )
          }
        />
      </SettingRow>
    </>
  );
}
