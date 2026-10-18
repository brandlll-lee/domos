import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { useId } from "react";
import { useSettings } from "../../settings/context.ts";
import { EngineAccount } from "./engine-account.tsx";
import { EngineModel, PiEngineModel } from "./engine-model.tsx";
import type { EngineSetup } from "./use-engine.ts";

export type EngineDialogKind = "install" | "account" | "model";

export function EngineDialog({
  dialog,
  name,
  botId,
  setup,
  canManage,
  modelBusy,
  onModelBusyChange,
  onClose,
  finalFocus,
}: {
  dialog: EngineDialogKind | null;
  name: string;
  botId: number;
  setup: EngineSetup;
  canManage: boolean;
  modelBusy: boolean;
  onModelBusyChange: (busy: boolean) => void;
  onClose: () => void;
  finalFocus: () => HTMLElement | null;
}) {
  const provider = setup.profile?.config.provider ?? "pi";
  const settings = useSettings();
  const formId = useId();
  const modelForm =
    dialog === "model" &&
    provider === "pi" &&
    canManage &&
    !settings.standalone;
  const pending = Boolean(setup.pending || modelBusy);
  const title =
    dialog === "install"
      ? `安装 ${name}`
      : dialog === "model"
        ? provider === "pi"
          ? "连接模型"
          : "选择模型"
        : `连接 ${name}`;
  const description =
    dialog === "install"
      ? "只在所选工作电脑下载和安装。"
      : dialog === "model"
        ? "选择此 Bot 使用的对话模型。"
        : "Domos 使用独立的配置和聊天记录。";
  return (
    <Dialog
      open={dialog !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      finalFocus={finalFocus}
      className="engine-dialog"
      title={title}
      description={description}
      footer={
        <div className="dialog-actions">
          <Button
            variant={modelForm ? "primary" : "secondary"}
            type={modelForm ? "submit" : "button"}
            form={modelForm ? formId : undefined}
            disabled={pending}
            onClick={modelForm ? undefined : onClose}
          >
            {setup.login?.state === "waiting" ? "取消登录" : "完成"}
          </Button>
        </div>
      }
    >
      <div className="engine-dialog-body">
        {dialog === "install" && (
          <div className="detail-stack">
            <p className="detail-note">需要联网。已有可用程序时会直接复用。</p>
            <Button
              disabled={setup.busy || !canManage}
              pending={setup.pending === "install"}
              onClick={() => void setup.install()}
            >
              {setup.pending === "install" ? "正在安装…" : `安装 ${name}`}
            </Button>
          </div>
        )}
        {dialog === "account" && (
          <EngineAccount
            provider={provider}
            setup={setup}
            canManage={canManage}
          />
        )}
        {dialog === "model" &&
          (provider === "pi" ? (
            <PiEngineModel
              botId={botId}
              setup={setup}
              canManage={canManage}
              onBusyChange={onModelBusyChange}
              formId={modelForm ? formId : undefined}
            />
          ) : (
            <EngineModel setup={setup} />
          ))}
        {setup.error && (
          <p className="alert" role="alert">
            {setup.error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
