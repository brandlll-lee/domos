import { Composer } from "./composer.tsx";
import { Messages } from "./messages.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { useChat } from "./use-chat.ts";

export function ChatPage() {
  const chat = useChat();
  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="wordmark" href="/">
          domos<span>.</span>
        </a>
        <div className="sidebar-label">个人空间</div>
        <div className="active-chat">
          <span className="chat-mark">D</span>与 Domos 对话
        </div>
        <p className="sidebar-note">
          想法、问题和下一步。
          <br />
          从这里开始。
        </p>
        <div className="sidebar-footer">
          <span className="status-dot" />
          本地工作空间
        </div>
      </aside>
      <main className="conversation">
        <header className="topbar">
          <div>
            <strong>与 Domos 对话</strong>
            <ModelPicker
              model={chat.view?.model ?? null}
              connected={chat.connected}
            />
          </div>
          <span className="connection" role="status">
            {chat.connected ? "已连接" : chat.view ? "正在重连…" : "正在连接…"}
          </span>
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
