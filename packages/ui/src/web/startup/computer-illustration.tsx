import type { ReactNode } from "react";
import "./computer-illustration.css";

export function ComputerIllustration({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <div className={`computer-illustration ${className}`}>
      <div className="computer-monitor">
        <div className="computer-screen">{children}</div>
        <span className="computer-power" />
      </div>
      <div className="computer-stand" />
      <div className="computer-foot" />
    </div>
  );
}
