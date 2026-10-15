import type { Bot, BotPresence } from "@domos/agent/bots";
import { messageText } from "@domos/agent/messages";
import { chatTranscript } from "@domos/agent/transcript";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { type CSSProperties, useState } from "react";
import { BotDetails } from "../bots/details/index.tsx";
import { useBots } from "../bots/use-bots.ts";
import { WorkingActivity } from "./activity.tsx";
import { Composer } from "./composer.tsx";
import { chatCopy } from "./copy.ts";
import { Messages } from "./messages.tsx";
import { ChatSettings } from "./settings.tsx";
import { Sidebar } from "./sidebar.tsx";
import { useChat } from "./use-chat.ts";
import { useComposerDock } from "./use-composer-dock.ts";

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
      directoryConnected={bots.connected}
    />
  );
}

function BotChat({
  bot,
  bots,
  directoryError,
  directoryConnected,
}: {
  bot: Bot;
  bots: BotPresence[];
  directoryError: string | null;
  directoryConnected: boolean;
}) {
  const chat = useChat(bot.id);
  const dock = useComposerDock();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const items = chat.view ? chatTranscript(chat.view) : [];
  const active = items.find(
    (item) => item.kind === "activity" && item.status === "running",
  );
  const connection = chat.connected
    ? chatCopy.connected
    : chat.view
      ? chatCopy.reconnecting
      : chatCopy.connecting;
  const latest = items.findLast((item) => item.kind === "message");
  const error =
    chat.error ??
    directoryError ??
    (chat.view?.failed ? chatCopy.errors.reply : null);
  return (
    <div className="workspace" data-details={detailsOpen || undefined}>
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
        connection={directoryConnected ? connection : chatCopy.reconnecting}
        connected={directoryConnected}
        preview={
          chat.view?.busy
            ? chatCopy.working
            : latest?.kind === "message"
              ? messageText(latest.message)
              : "开始对话"
        }
      />
      <main
        className="conversation chat-surface"
        id="conversation"
        tabIndex={-1}
        style={
          { "--composer-dock-height": `${dock.height}px` } as CSSProperties
        }
      >
        <header className="chat-header">
          <Button
            variant="secondary"
            className="conversation-title"
            aria-label="Bot详情"
            aria-expanded={detailsOpen}
            aria-controls={detailsOpen ? "bot-details" : undefined}
            onClick={() => setDetailsOpen(!detailsOpen)}
          >
            <BotAvatar seed={bot.avatar} size="small" />
            <span>{bot.name}</span>
          </Button>
          <span className="sr-only" role="status">
            {connection}
          </span>
        </header>
        <Messages view={chat.view} botName={bot.name} items={items} />
        {chat.view ? (
          <Composer
            ref={dock.ref}
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
            status={
              active?.kind === "activity" ? (
                <WorkingActivity activity={active} bot={bot} />
              ) : null
            }
          />
        ) : (
          error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )
        )}
      </main>
      {detailsOpen && (
        <BotDetails bot={bot} onClose={() => setDetailsOpen(false)}>
          <ChatSettings
            bot={bot}
            bots={bots}
            model={chat.view?.model ?? null}
            connected={chat.connected}
          />
        </BotDetails>
      )}
    </div>
  );
}
