import type { Bot, BotPresence } from "@domos/agent/bots";
import { chatTranscript } from "@domos/agent/transcript";
import { type CSSProperties, useState } from "react";
import { CreateBot } from "../bots/create-bot.tsx";
import { BotDetails, type BotPanel } from "../bots/details/index.tsx";
import { selectBot, useBots } from "../bots/use-bots.ts";
import { ComputerPanel } from "../computer/panel.tsx";
import { useComputer } from "../computer/use-computer.ts";
import { useSettings } from "../settings/context.ts";
import { Workspace } from "../shell/workspace.tsx";
import { WorkingActivity } from "./activity.tsx";
import { Composer } from "./composer.tsx";
import { chatCopy } from "./copy.ts";
import { ChatHeader } from "./header.tsx";
import { Messages } from "./messages.tsx";
import { ModelPicker } from "./model-picker.tsx";
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailPanel, setDetailPanel] = useState<BotPanel>("profile");
  const items = chat.view ? chatTranscript(chat.view) : [];
  const active = items.find(
    (item) => item.kind === "activity" && item.status === "running",
  );
  const connection = chat.connected
    ? chatCopy.connected
    : chat.view
      ? chatCopy.reconnecting
      : chatCopy.connecting;
  const error =
    chat.error ??
    directoryError ??
    (chat.view?.failed ? chatCopy.errors.reply : null);
  const showPanel = (panel: BotPanel) => {
    setDetailPanel(panel);
    setDetailsOpen(!detailsOpen || detailPanel !== panel);
  };
  return (
    <Workspace
      detailsOpen={detailsOpen}
      onDetailsChange={setDetailsOpen}
      onSettings={() => settings.open()}
      page={settings.page}
      actions={
        <CreateBot model={chat.view?.model ?? null} onCreated={selectBot} />
      }
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
            <ModelPicker
              botId={bot.id}
              model={chat.view?.model ?? null}
              connected={chat.connected}
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
          view={chat.view}
          botName={bot.name}
          createdAt={bot.createdAt}
          items={items}
        />
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
            computerReady={Boolean(
              computer.status?.authorized &&
                (computer.status.capabilities.files || computer.status.scope),
            )}
            onComputerRequired={() => {
              setDetailPanel("computer");
              setDetailsOpen(true);
            }}
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
    </Workspace>
  );
}
