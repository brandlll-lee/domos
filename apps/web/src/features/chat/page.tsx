import { ChatCircleDotsIcon } from "@phosphor-icons/react/dist/csr/ChatCircleDots";
import { HardDrivesIcon } from "@phosphor-icons/react/dist/csr/HardDrives";
import { Composer } from "./composer.tsx";
import { Messages } from "./messages.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { useChat } from "./use-chat.ts";

export function ChatPage() {
  const chat = useChat();
  const latest = chat.view?.messages.at(-1);
  const title =
    chat.view?.messages.find((message) => message.role === "user")?.text ??
    "与 Domos 对话";
  const connection = chat.connected
    ? "已连接"
    : chat.view
      ? "正在重连…"
      : "正在连接…";
  return (
    <div className="workspace">
      <a className="skip-link" href="#conversation">
        跳到对话
      </a>
      <aside className="sidebar">
        <a className="wordmark" href="/">
          domos<span>.</span>
        </a>
        <div className="sidebar-label">个人空间</div>
        <nav aria-label="对话">
          <a className="active-chat" href="#conversation" aria-current="page">
            <span className="avatar">
              <ChatCircleDotsIcon />
            </span>
            <span className="chat-summary">
              <strong>{title}</strong>
              <span>
                {chat.view?.busy
                  ? "正在回复…"
                  : latest?.text || "从一个想法开始"}
              </span>
            </span>
          </a>
        </nav>
        <div className="sidebar-footer">
          <HardDrivesIcon />
          <span>
            本地工作空间<small>对话自动保存</small>
          </span>
        </div>
      </aside>
      <main className="conversation" id="conversation" tabIndex={-1}>
        <header className="topbar">
          <div className="conversation-heading">
            <span className="avatar">
              <ChatCircleDotsIcon />
            </span>
            <div>
              <strong>与 Domos 对话</strong>
              <span
                className="connection"
                data-connected={chat.connected}
                role="status"
              >
                {connection}
              </span>
            </div>
          </div>
          <ModelPicker
            model={chat.view?.model ?? null}
            connected={chat.connected}
          />
        </header>
        <Messages view={chat.view} />
        {chat.view ? (
          <Composer
            key={chat.view.id}
            conversationId={chat.view.id}
            chat={chat}
          />
        ) : (
          chat.error && (
            <p className="alert" role="alert">
              {chat.error}
            </p>
          )
        )}
      </main>
    </div>
  );
}
