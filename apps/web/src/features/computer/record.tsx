import type { ComputerView } from "@domos/agent/computer/catalog";
import { Dialog } from "@domos/ui/dialog";
import { Disclosure } from "@domos/ui/disclosure";
import { ActionMenu } from "@domos/ui/menu";
import { PanelRow } from "@domos/ui/panel";
import { SettingRow } from "@domos/ui/setting-row";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { useState } from "react";
import { client } from "../../client.ts";
import { computerLabels } from "./copy.ts";
import { ConfirmComputerAction } from "./dialogs.tsx";

type RecordProps = {
  item: ComputerView;
  admin: boolean;
  busy: boolean;
  error: string;
  bots: string[];
  run: (action: () => Promise<unknown>) => Promise<boolean>;
};

export function ComputerRecord(props: RecordProps) {
  const { item, admin, bots } = props;
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  return (
    <>
      <div className="computer-record">
        <PanelRow
          icon={<DesktopIcon />}
          title={item.name}
          value={`${item.error ? "连接异常" : item.authorized ? computerLabels.state[item.state] : "待授权"} · ${bots.length} 个机器人`}
          onClick={() => setOpen(true)}
        />
        <ActionMenu
          label={`${item.name}的更多操作`}
          items={[
            { label: "查看详情", onSelect: () => setOpen(true) },
            ...(item.kind === "process"
              ? []
              : [
                  {
                    label: "高级设置",
                    onSelect: () => {
                      setAdvanced(true);
                      setOpen(true);
                    },
                  },
                ]),
          ]}
        />
      </div>
      <Dialog open={open} onOpenChange={setOpen} title={item.name}>
        <div className="settings-group">
          <SettingRow title="位置">
            {computerLabels.boundary[item.boundary]}
          </SettingRow>
          <SettingRow title="状态">
            {computerLabels.state[item.state]}
          </SettingRow>
          <SettingRow title="使用此电脑的机器人">
            {bots.join("、") || "暂无"}
          </SettingRow>
          <SettingRow title="文件位置">{item.directory}</SettingRow>
          {item.error && (
            <p className="alert" role="alert">
              {item.error}
            </p>
          )}
          {admin && <ComputerAccess {...props} />}
          {item.kind === "process" ? (
            <SettingRow title="网络">
              {computerLabels.network[item.network]}
            </SettingRow>
          ) : (
            <Disclosure
              open={advanced}
              onToggle={(event) => setAdvanced(event.currentTarget.open)}
              label="高级设置"
            >
              <SettingRow title="网络">
                {computerLabels.network[item.network]}
              </SettingRow>
              {admin && item.authorized && <ContainerSettings {...props} />}
            </Disclosure>
          )}
        </div>
      </Dialog>
    </>
  );
}

function ComputerAccess({ item, bots, busy, error, run }: RecordProps) {
  return (
    <SettingRow
      title="工具访问"
      description={
        item.kind === "process"
          ? "使用服务所在电脑的命令与文件，权限与服务进程相同。"
          : "允许已分配的 Bot 使用此电脑的命令与文件。"
      }
    >
      {item.authorized ? (
        <ConfirmComputerAction
          title="撤销授权"
          label="撤销授权"
          description={`此电脑上的命令与文件工具将停用。使用者：${bots.join("、") || "暂无"}。`}
          busy={busy}
          error={error}
          onConfirm={() =>
            run(() =>
              client.computer.authorize({ id: item.id, authorized: false }),
            )
          }
        />
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

function ContainerSettings({ item, bots, busy, error, run }: RecordProps) {
  const running = item.state === "running";
  return (
    <>
      <SettingRow
        title="容器运行"
        description="停止容器内的进程。下次使用工具时，自动准备的电脑会重新启动。"
      >
        <ConfirmComputerAction
          title={running ? "停止电脑" : "启动电脑"}
          label={running ? "确认停止" : "确认启动"}
          description={`使用者：${bots.join("、") || "暂无"}。${running ? "容器内的进程将结束。" : "将启动此工作电脑。"}`}
          busy={busy}
          error={error}
          onConfirm={() =>
            run(() =>
              client.computer.manage({
                id: item.id,
                action: running ? "stop" : "start",
              }),
            )
          }
        />
      </SettingRow>
      <SettingRow
        title="重建容器"
        description="保留工作卷，并结束容器内的进程。"
      >
        <ConfirmComputerAction
          title="重建工作容器"
          label="确认重建"
          description={`工作卷保留，容器内的进程将结束。使用者：${bots.join("、") || "暂无"}。`}
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
