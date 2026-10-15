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
