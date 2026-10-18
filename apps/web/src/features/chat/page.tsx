import type { Bot, BotPresence } from "@domos/agent/bots";
import { type ChatMessage, messageText } from "@domos/agent/messages";
import { type CSSProperties, useCallback, useRef, useState } from "react";
import { CreateBot } from "../bots/create-bot.tsx";
import { EnginePanel } from "../bots/details/engine.tsx";
import { BotDetails, type BotPanel } from "../bots/details/index.tsx";
import { selectBot, useBots } from "../bots/use-bots.ts";
import { ComputerPanel } from "../computer/panel.tsx";
import { useComputer } from "../computer/use-computer.ts";
import { useSettings } from "../settings/context.ts";
import { Workspace } from "../shell/workspace.tsx";
import { Approvals } from "./approvals.tsx";
import { Composer } from "./composer.tsx";
import { chatCopy } from "./copy.ts";
import { ChatHeader } from "./header.tsx";
import { Messages } from "./messages.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { Sidebar } from "./sidebar.tsx";
import { useChat } from "./use-chat.ts";
import { useComposerDock } from "./use-composer-dock.ts";
import { useDraft } from "./use-draft.ts";
import { ChatWelcome } from "./welcome.tsx";

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
      directory={bots}
    />
  );
}

function BotChat({
  bot,
  bots,
  directoryError,
  directoryConnected,
  directory,
}: {
  bot: Bot;
  bots: BotPresence[];
  directoryError: string | null;
  directoryConnected: boolean;
  directory: ReturnType<typeof useBots>;
}) {
  const settings = useSettings();
  const chat = useChat(bot.id, () => settings.open("models", bot.id));
  const computer = useComputer(bot.id, directory);
  const dock = useComposerDock();
  const draft = useDraft(bot.id);
  const input = useRef<HTMLTextAreaElement>(null);
  const retry = useCallback(
    (original: ChatMessage) => {
      draft.update({
        text: messageText(original),
        attachments: original.attachments ?? [],
        pending: null,
      });
      input.current?.focus();
    },
    [draft.update],
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailPanel, setDetailPanel] = useState<BotPanel>("profile");
  const { items } = chat;
  const connection = chat.connected
    ? chatCopy.connected
    : chat.view
      ? chatCopy.reconnecting
      : chatCopy.connecting;
  const error =
    chat.error ??
    directoryError ??
    (!items.some(
      (item) => item.kind === "notice" && item.status === "failed",
    ) && chat.view?.failed
      ? chatCopy.errors.reply
      : null);
  const showPanel = (panel: BotPanel) => {
    setDetailPanel(panel);
    setDetailsOpen(!detailsOpen || detailPanel !== panel);
  };
  return (
    <Workspace
      detailsOpen={detailsOpen}
      onDetailsChange={setDetailsOpen}
      onSettings={() => settings.open()}
      actions={<CreateBot onCreated={selectBot} />}
      sidebar={
        <Sidebar bots={bots} selected={bot} connected={directoryConnected} />
      }
      inspector={
        <BotDetails
          active={detailsOpen}
          bot={bot}
          panel={detailPanel}
          onPanelChange={setDetailPanel}
          onClose={() => setDetailsOpen(false)}
          computer={<ComputerPanel computer={computer} botId={bot.id} />}
          model={
            <EnginePanel
              botId={bot.id}
              active={detailsOpen}
              canManage={settings.admin}
              piModel={(onSelected, onBusyChange) => (
                <ModelPicker
                  botId={bot.id}
                  model={chat.view?.model ?? null}
                  connected={chat.connected}
                  onSelected={onSelected}
                  onBusyChange={onBusyChange}
                />
              )}
            />
          }
        />
      }
    >
      <button
        className="skip-link"
        type="button"
        onClick={() => {
          document.getElementById("conversation")?.focus();
        }}
      >
        {chatCopy.skip}
      </button>

      <main
        className="conversation chat-surface"
        id="conversation"
        tabIndex={-1}
        style={
          { "--composer-dock-height": `${dock.height}px` } as CSSProperties
        }
      >
        <ChatHeader
          bot={bot}
          detailsOpen={detailsOpen}
          onProfile={() => showPanel("profile")}
          onComputer={() => showPanel("computer")}
        />
        <span className="sr-only" role="status">
          {connection}
        </span>
        <Messages
          botId={bot.id}
          ready={Boolean(chat.view)}
          busy={Boolean(chat.view?.busy)}
          botName={bot.name}
          avatar={bot.avatar}
          createdAt={bot.createdAt}
          items={items}
          onRetry={retry}
          welcome={
            !bot.welcomeComplete &&
            !chat.view?.messages.length && (
              <ChatWelcome
                botId={bot.id}
                disabled={!chat.connected || Boolean(draft.draft.pending)}
                onChoose={(text) => {
                  const current = draft.current.current.text;
                  draft.update({
                    text: current.trim() ? `${current}\n\n${text}` : text,
                  });
                  input.current?.focus();
                }}
                onDismissed={() => input.current?.focus()}
              />
            )
          }
        />
        {chat.view ? (
          <Composer
            ref={dock.ref}
            inputRef={input}
            draft={draft}
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
            computerReady={Boolean(
              computer.status?.authorized &&
                (computer.status.capabilities.files || computer.status.scope),
            )}
            onComputerRequired={() => {
              setDetailPanel("computer");
              setDetailsOpen(true);
            }}
            status={
              !!chat.view.approvals?.length && (
                <Approvals botId={bot.id} approvals={chat.view.approvals} />
              )
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
    </Workspace>
  );
}
