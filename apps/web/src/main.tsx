import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@domos/ui/style.css";
import "./features/chat/style.css";
import { connectionLink } from "@domos/hosting/instance";
import { prepareAvatarImages, thumbnailEyes } from "@domos/ui/avatar";
import { initializeTheme, ThemeProvider } from "@domos/ui/theme";
import { IconContext } from "@phosphor-icons/react/dist/lib/context";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatPage } from "./features/chat/page.tsx";
import { HostingRoot } from "./features/hosting/root.tsx";

const root = document.getElementById("root");
let pairingCode: string | undefined;
let pairingError: string | undefined;
if (location.hash.startsWith("#pair=")) {
  const link = location.href;
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${location.search}`,
  );
  try {
    pairingCode = connectionLink(link).code;
  } catch {
    pairingError = "配对链接无效。请重新获取链接或输入配对码。";
  }
}
const initialPreference = initializeTheme();
void prepareAvatarImages(thumbnailEyes);
if (root)
  createRoot(root).render(
    <StrictMode>
      <IconContext value={{ size: 18, weight: "regular", "aria-hidden": true }}>
        <ThemeProvider initialPreference={initialPreference}>
          <HostingRoot pairingCode={pairingCode} pairingError={pairingError}>
            <ChatPage />
          </HostingRoot>
        </ThemeProvider>
      </IconContext>
    </StrictMode>,
  );
