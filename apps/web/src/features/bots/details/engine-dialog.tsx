import { BrandMark } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { useEffect, useRef } from "react";
import { EngineMark } from "../engine-mark.tsx";
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
  onModelBusyChange,
  onClose,
  onDialogChange,
  finalFocus,
}: {
  dialog: EngineDialogKind | null;
  name: string;
  botId: number;
  setup: EngineSetup;
  canManage: boolean;
  onModelBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onDialogChange: (dialog: EngineDialogKind | null) => void;
  finalFocus?: () => HTMLElement | null;
}) {
  const completedLogin = useRef(setup.login);
  useEffect(() => {
    if (setup.busy) return;
    if (
      dialog === "account" &&
      setup.login?.state === "done" &&
      setup.profile?.prepared &&
      completedLogin.current !== setup.login
    ) {
      completedLogin.current = setup.login;
      onClose();
    }
    if (dialog === "install" && setup.connection?.ready)
      onDialogChange(
        setup.profile?.prepared
          ? null
          : setup.profile?.config.accountSource === "native"
            ? "model"
            : "account",
      );
  }, [
    dialog,
    setup.busy,
    setup.login,
    setup.profile?.prepared,
    setup.profile?.config.accountSource,
    setup.connection?.ready,
    onClose,
    onDialogChange,
  ]);
  const provider = setup.profile?.config.provider ?? "pi";
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
        if (!open && !setup.pending) onClose();
      }}
      finalFocus={finalFocus}
      className={`engine-dialog${dialog === "model" && provider === "pi" ? " engine-dialog-models" : ""}`}
      title={
        <span className="engine-dialog-title">
          <BrandMark />
          {title}
        </span>
      }
      description={description}
    >
      <div className="engine-dialog-body">
        <div className="engine-dialog-identity">
          <EngineMark provider={provider} />
          <span>{name}</span>
        </div>
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
            botId={botId}
            setup={setup}
            canManage={canManage}
            onConnected={onClose}
          />
        )}
        {dialog === "model" &&
          (provider === "pi" &&
          setup.profile?.config.accountSource !== "native" ? (
            <PiEngineModel
              botId={botId}
              setup={setup}
              canManage={canManage}
              onBusyChange={onModelBusyChange}
              onSelected={onClose}
            />
          ) : (
            <EngineModel setup={setup} onSelected={onClose} />
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
