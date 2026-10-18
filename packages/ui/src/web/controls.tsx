import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { ComponentProps } from "react";

export function Button({
  variant = "primary",
  size = "default",
  className = "",
  pending = false,
  disabled,
  children,
  ...props
}: ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "default" | "small" | "icon" | "icon-small";
  pending?: boolean;
}) {
  return (
    <button
      className={`button ${className}`}
      data-variant={variant}
      data-size={size}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending && <span className="button-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Switch({
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <BaseSwitch.Root
      className="switch"
      nativeButton
      render={<button type="button" />}
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
    >
      <BaseSwitch.Thumb className="switch-thumb" />
    </BaseSwitch.Root>
  );
}
