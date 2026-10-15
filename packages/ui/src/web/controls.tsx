import type { ComponentProps } from "react";

export function Button({
  variant = "primary",
  size = "default",
  className = "",
  ...props
}: ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "default" | "icon";
}) {
  return (
    <button
      className={`button ${className}`}
      data-variant={variant}
      data-size={size}
      {...props}
    />
  );
}

export function Select({
  variant = "default",
  className = "",
  ...props
}: ComponentProps<"select"> & {
  variant?: "default" | "quiet";
}) {
  return (
    <select
      className={`select ${className}`}
      data-variant={variant}
      {...props}
    />
  );
}
