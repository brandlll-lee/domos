import { type ReactNode, useId } from "react";

export function SettingRow({
  title,
  description,
  notice,
  children,
}: {
  title: string;
  description?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset className="setting-row" aria-labelledby={id}>
      <div className="setting-caption">
        <strong id={id}>{title}</strong>
        {description && (
          <div className="setting-description">{description}</div>
        )}
      </div>
      <div className="setting-control">{children}</div>
      {notice && <div className="setting-notice">{notice}</div>}
    </fieldset>
  );
}
