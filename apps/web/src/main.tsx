import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatPage } from "./features/chat/page.tsx";
import "./ui/style.css";
import "./features/chat/style.css";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <ChatPage />
    </StrictMode>,
  );
