import { IconContext } from "@phosphor-icons/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatPage } from "./features/chat/page.tsx";
import "@fontsource-variable/geist/wght.css";
import "./ui/style.css";
import "./features/chat/style.css";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <IconContext value={{ size: 18, weight: "regular", "aria-hidden": true }}>
        <ChatPage />
      </IconContext>
    </StrictMode>,
  );
