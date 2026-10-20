import { Button, Switch } from "@domos/ui/controls";
import { SettingRow } from "@domos/ui/setting-row";
import { serviceLabels, useComputerServices } from "./use-services.ts";

export function ComputerServices({
  botId,
  admin,
}: {
  botId: number;
  admin: boolean;
}) {
  const { state, busy, error, configure, reload } = useComputerServices(botId);
  return (
    <section className="detail-stack" aria-label="浏览器和桌面">
      <div className="detail-form-head">
        <h3 className="panel-group-title">允许的操作</h3>
      </div>
      <div className="panel-card computer-services">
        {(["browser", "desktop"] as const).map((service) => (
          <SettingRow
            key={service}
            title={serviceLabels[service]}
            description={state?.[service].enabled ? "已允许" : "未允许"}
          >
            <Switch
              label={`允许${serviceLabels[service]}`}
              checked={state?.[service].enabled ?? false}
              disabled={!admin || Boolean(busy) || !state}
              onCheckedChange={(enabled) => void configure(service, enabled)}
            />
          </SettingRow>
        ))}
      </div>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {error && !state && (
        <Button variant="secondary" size="small" onClick={reload}>
          重新连接
        </Button>
      )}
    </section>
  );
}
