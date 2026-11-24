import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./controls.tsx";
import "./titlebar.css";

declare global {
  interface Window {
    domosWindow?: {
      platform: string;
      command(
        action: "state" | "minimize" | "maximize" | "close",
      ): Promise<{ maximized: boolean }>;
      subscribe(listener: (state: { maximized: boolean }) => void): () => void;
    };
  }
}

export function DesktopTitlebar({ className = "" }: { className?: string }) {
  const controls = window.domosWindow;
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (controls?.platform !== "win32") return;
    let active = true;
    const update = (state: { maximized: boolean }) => {
      if (active) setMaximized(state.maximized);
    };
    const unsubscribe = controls.subscribe(update);
    void controls.command("state").then(update, () => {
      if (active) setError("无法读取窗口状态");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  if (!controls) return null;
  async function command(action: "minimize" | "maximize" | "close") {
    setError("");
    try {
      const state = await controls?.command(action);
      if (state) setMaximized(state.maximized);
    } catch {
      setError("窗口操作未完成");
    }
  }
  return createPortal(
    <header
      className={`app-titlebar ${className}`}
      data-platform={controls.platform}
    >
      {error && <span role="alert">{error}</span>}
      {controls.platform === "win32" && (
        <div className="window-caption">
          <Button
            variant="ghost"
            className="window-caption-button"
            aria-label="最小化窗口"
            onClick={() => void command("minimize")}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 6h10" />
            </svg>
          </Button>
          <Button
            variant="ghost"
            className="window-caption-button"
            aria-label={maximized ? "还原窗口" : "最大化窗口"}
            onClick={() => void command("maximize")}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              {maximized ? (
                <path d="M3.5 3.5v-2h7v7h-2m-7-5h7v7h-7z" />
              ) : (
                <path d="M1.5 1.5h9v9h-9z" />
              )}
            </svg>
          </Button>
          <Button
            variant="ghost"
            className="window-caption-button window-caption-close"
            aria-label="关闭窗口"
            onClick={() => void command("close")}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="m1.5 1.5 9 9m0-9-9 9" />
            </svg>
          </Button>
        </div>
      )}
    </header>,
    document.body,
  );
}
