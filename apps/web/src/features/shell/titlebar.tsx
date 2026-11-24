import { DesktopTitlebar } from "@domos/ui/titlebar";
import { useEffect } from "react";

export function Titlebar({ loading = false }: { loading?: boolean }) {
  const desktop = window.domosDesktop;
  useEffect(() => {
    if (!desktop?.appearance) return;
    const sync = () =>
      void desktop.appearance(
        loading || document.documentElement.dataset.theme === "dark"
          ? "dark"
          : "light",
      );
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [loading]);
  return <DesktopTitlebar />;
}
