import { Button, Switch } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { PanelCard } from "@domos/ui/panel";
import { SettingRow } from "@domos/ui/setting-row";
import { type ComponentProps, useLayoutEffect, useRef } from "react";
import { ConnectionEditor } from "./connection-editor.tsx";
import { ConnectionSurface } from "./connection-page.tsx";

export function ConnectionSetup({
  open,
  onBack,
  onContinue,
  onImport,
  error,
  finalFocus,
  ...editor
}: ComponentProps<typeof ConnectionEditor> & {
  open: boolean;
  onBack: () => void;
  onContinue: () => void;
  onImport: () => void;
  error?: string;
  finalFocus?: () => HTMLElement | null;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open)
      viewport.current
        ?.querySelector<HTMLElement>(
          editor.step === "import" ? "textarea" : "input",
        )
        ?.focus();
  }, [open, editor.step]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !editor.busy) onBack();
      }}
      layout="task"
      viewportRef={viewport}
      finalFocus={finalFocus}
      className="connection-setup-dialog"
      title={editor.form.editing ? "编辑连接" : "添加 MCP"}
      headerActions={
        editor.step === "confirm" && !editor.form.editing ? (
          <Button
            variant="ghost"
            size="small"
            disabled={editor.busy}
            onClick={onImport}
          >
            导入配置
          </Button>
        ) : undefined
      }
      footer={
        <div className="dialog-actions">
          <Button variant="ghost" disabled={editor.busy} onClick={onBack}>
            取消
          </Button>
          {editor.step === "import" ? (
            <Button
              key="import"
              type="button"
              disabled={!editor.form.paste.trim()}
              onClick={onContinue}
            >
              继续
            </Button>
          ) : (
            <Button
              key="confirm"
              type="submit"
              form="connection-editor"
              pending={editor.busy}
            >
              保存并测试
            </Button>
          )}
        </div>
      }
    >
      <div className="connection-setup">
        {error && (
          <div role="alert">
            <InlineNotice>{error}</InlineNotice>
          </div>
        )}
        <ConnectionEditor {...editor} />
      </div>
    </Dialog>
  );
}

export function NativeConnectionSettings({
  onBack,
  items,
  onChange,
  busy = false,
  loading = false,
  error,
  onRefresh,
}: {
  onBack: () => void;
  items: { botId: number; name: string; enabled: boolean }[];
  onChange: (botId: number, enabled: boolean) => void;
  busy?: boolean;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
}) {
  return (
    <ConnectionSurface
      title="原生连接设置"
      path="原生连接设置"
      onBack={onBack}
      backLabel="连接中心"
    >
      {error && (
        <div role="alert" className="connection-read-notice">
          <InlineNotice>{error}</InlineNotice>
          <Button variant="ghost" size="small" onClick={onRefresh}>
            重新读取
          </Button>
        </div>
      )}
      {loading && <Loading label="正在读取原生连接" />}
      <section className="connection-section connection-setup">
        <div className="connection-section-heading">
          <h2>沿用原生连接</h2>
          <p>在伙伴的下一轮工作中使用。配置仍由原生 Harness 管理。</p>
        </div>
        <PanelCard>
          {items.map((item) => (
            <SettingRow key={item.botId} title={item.name}>
              <Switch
                label={`${item.name}沿用原生连接`}
                checked={item.enabled}
                disabled={busy}
                onCheckedChange={(checked) => onChange(item.botId, checked)}
              />
            </SettingRow>
          ))}
        </PanelCard>
      </section>
    </ConnectionSurface>
  );
}
