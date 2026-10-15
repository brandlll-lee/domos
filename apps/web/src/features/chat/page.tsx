import type { Bot } from "@domos/agent/bots";
import { messageText } from "@domos/agent/messages";
import { SearchPicker } from "@domos/ui/picker";
import { AppearancePicker } from "../appearance/picker.tsx";
import { CreateBot } from "../bots/create-bot.tsx";
import { selectBot, useBots } from "../bots/use-bots.ts";
import { Composer } from "./composer.tsx";
import { chatCopy } from "./copy.ts";
import { Messages } from "./messages.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { Sidebar } from "./sidebar.tsx";
import { useChat } from "./use-chat.ts";

export function ChatPage() {
  const bots = useBots();
  if (!bots.selected)
    return (
      <p className="working" role={bots.error ? "alert" : "status"}>
        {bots.error ?? "正在加载联系人…"}
      </p>
    );
  return (
    <BotChat
      key={bots.selected.id}
      bot={bots.selected}
      bots={bots.items}
      directoryError={bots.error}
    />
  );
}

function BotChat({
  bot,
  bots,
  directoryError,
}: {
  bot: Bot;
  bots: Bot[];
  directoryError: string | null;
}) {
  const chat = useChat(bot.id);
  const connection = chat.connected
    ? chatCopy.connected
    : chat.view
      ? chatCopy.reconnecting
      : chatCopy.connecting;
  const latest = chat.view?.messages.findLast(
    (message) => message.role !== "toolResult",
  );
  const error =
    chat.error ??
    directoryError ??
    (chat.view?.failed ? chatCopy.errors.reply : null);
  return (
    <div className="workspace">
      <button
        className="skip-link"
        type="button"
        onClick={() => {
          document.getElementById("conversation")?.focus();
        }}
      >
        {chatCopy.skip}
      </button>
      <Sidebar
        bots={bots}
        selected={bot}
        model={chat.view?.model ?? null}
        connection={connection}
        preview={
          chat.view?.busy
            ? chatCopy.working
            : latest
              ? messageText(latest)
              : "开始对话"
        }
      />
      <main className="conversation" id="conversation" tabIndex={-1}>
        <header className="topbar">
          <div className="conversation-heading">
            <strong>{chatCopy.conversation(bot.name)}</strong>
            <div className="mobile-contacts">
              <SearchPicker
                label="联系人"
                searchLabel="搜索联系人…"
                emptyLabel="没有找到联系人"
                placeholder={bot.name}
                items={bots.map((item) => ({
                  value: String(item.id),
                  label: item.name,
                }))}
                value={String(bot.id)}
                onValueChange={(value) => {
                  const selected = bots.find(
                    (item) => String(item.id) === value,
                  );
                  if (selected) selectBot(selected);
                }}
              />
              <CreateBot
                model={chat.view?.model ?? null}
                onCreated={selectBot}
              />
            </div>
            <span
              className={chat.connected ? "sr-only" : "connection"}
              role="status"
            >
              {connection}
            </span>
          </div>
          <div className="header-actions">
            <ModelPicker
              botId={bot.id}
              model={chat.view?.model ?? null}
              connected={chat.connected}
            />
            <AppearancePicker />
          </div>
        </header>
        <Messages view={chat.view} botName={bot.name} />
        {chat.view ? (
          <Composer
            key={chat.view.id}
            botName={bot.name}
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
