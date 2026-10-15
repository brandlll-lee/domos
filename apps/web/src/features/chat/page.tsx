import { messageText } from "@domos/agent/messages";
import { AppearancePicker } from "../appearance/picker.tsx";
import { Composer } from "./composer.tsx";
import { chatCopy } from "./copy.ts";
import { Messages } from "./messages.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { Sidebar } from "./sidebar.tsx";
import { useChat } from "./use-chat.ts";

export function ChatPage() {
  const chat = useChat();
  const connection = chat.connected
    ? chatCopy.connected
    : chat.view
      ? chatCopy.reconnecting
      : chatCopy.connecting;
  const latest = chat.view?.messages.findLast(
    (message) => message.role !== "toolResult",
  );
  const error =
    chat.error ?? (chat.view?.failed ? chatCopy.errors.reply : null);
  return (
    <div className="workspace">
      <a className="skip-link" href="#conversation">
        {chatCopy.skip}
      </a>
      <Sidebar
        connection={connection}
        preview={
          chat.view?.busy
            ? chatCopy.working
            : latest
              ? messageText(latest)
              : chatCopy.name
        }
      />
      <main className="conversation" id="conversation" tabIndex={-1}>
        <header className="topbar">
          <div className="conversation-heading">
            <strong>{chatCopy.conversation}</strong>
            <span
              className={chat.connected ? "sr-only" : "connection"}
              role="status"
            >
              {connection}
            </span>
          </div>
          <div className="header-actions">
            <ModelPicker
              model={chat.view?.model ?? null}
              connected={chat.connected}
            />
            <AppearancePicker />
          </div>
        </header>
        <Messages view={chat.view} />
        {chat.view ? (
          <Composer
            key={chat.view.id}
            conversationId={chat.view.id}
            connected={chat.connected}
            busy={chat.view.busy}
            sending={chat.sending}
            stopping={chat.stopping}
            error={error}
            onSend={chat.send}
            onStop={chat.stop}
          />
        ) : (
          error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )
        )}
      </main>
    </div>
  );
}
