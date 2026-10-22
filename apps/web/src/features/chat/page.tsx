import type { Bot, BotPresence } from "@domos/agent/bots";
import { type ChatMessage, messageText } from "@domos/agent/messages";
import { characterIdentity } from "@domos/ui/characters";
import { type CSSProperties, useCallback, useRef, useState } from "react";
import { CreateBot } from "../bots/create-bot.tsx";
import { BotDetails, type BotPanelView } from "../bots/details/index.tsx";
import { useEngine } from "../bots/details/use-engine.ts";
import { selectBot, useBots } from "../bots/use-bots.ts";
import { useComputer } from "../computer/use-computer.ts";
import { ComputerWorkspace } from "../computer/workspace.tsx";
import { EngineSelector } from "../models/engine-selector.tsx";
import { useSettings } from "../settings/context.ts";
import { type RailView, Workspace } from "../shell/workspace.tsx";
import { UsageSurface } from "../usage/page.tsx";
import { Approvals } from "./approvals.tsx";
import { Composer } from "./composer.tsx";
import { ContextRing } from "./context.tsx";
import { chatCopy } from "./copy.ts";
import { ChatHeader } from "./header.tsx";
import { Messages } from "./messages.tsx";
import { RuntimeStatus } from "./runtime.tsx";
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
  const chat = useChat(bot.id, () => settings.open("providers", bot.id));
  const engine = useEngine(bot.id, chat.connected, Boolean(chat.view?.busy));
  const computer = useComputer(bot.id, directory);
  const dock = useComposerDock();
  const draft = useDraft(bot.id);
  const input = useRef<HTMLTextAreaElement>(null);
  const resend = useCallback(
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
  const [view, setView] = useState<"chat" | "usage">("chat");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [panel, setPanel] = useState<"settings" | "computer">("settings");
  const [expanded, setExpanded] = useState(false);
  const [detailPanel, setDetailPanel] = useState<BotPanelView>("root");
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
  const showPanel = (view: BotPanelView) => {
    const open = !detailsOpen || panel !== "settings" || detailPanel !== view;
    setView("chat");
    setPanel("settings");
    setExpanded(false);
    setDetailPanel(view);
    setDetailsOpen(open);
  };
  const closePanel = () => {
    setDetailsOpen(false);
    setExpanded(false);
  };
  const showComputer = () => {
    setPanel("computer");
    setExpanded(false);
    setView("chat");
    setDetailsOpen(!detailsOpen || panel !== "computer");
  };
  const computerOpen = detailsOpen && panel === "computer";
  const railActive =
    view === "usage" ? "usage" : computerOpen ? "computer" : "conversation";
  const selectRail = (next: RailView) => {
    if (next === "computer") {
      showComputer();
      return;
    }
    setView(next === "usage" ? "usage" : "chat");
    closePanel();
  };
  return (
    <Workspace
      detailsOpen={detailsOpen}
      onDetailsChange={(open) => {
        if (open) setDetailsOpen(true);
        else closePanel();
      }}
      expanded={panel === "computer" && expanded}
      inspectorTitle={panel === "computer" ? "工作电脑" : "Bot详情"}
      inspectorTrigger={
        panel === "computer" ? "computer-trigger" : "details-trigger"
      }
      rail={{ active: railActive, onSelect: selectRail }}
      sidebarOpen={view === "chat"}
      onSettings={() => settings.open("general", bot.id)}
      actions={<CreateBot onCreated={selectBot} />}
      sidebar={
        <Sidebar bots={bots} selected={bot} connected={directoryConnected} />
      }
      inspector={
        <>
          <div className="inspector-page" hidden={panel !== "settings"}>
            <BotDetails
              active={detailsOpen && panel === "settings"}
              bot={bot}
              view={detailPanel}
              onViewChange={setDetailPanel}
              onClose={closePanel}
              computer={computer}
              chat={{
                model: chat.view?.model ?? null,
                connected: chat.connected,
              }}
              canManage={settings.admin}
              engine={engine}
            />
          </div>
          {detailsOpen && panel === "computer" && (
            <ComputerWorkspace
              bot={bot}
              computer={computer}
              admin={settings.admin}
              expanded={expanded}
              onExpand={() => setExpanded((value) => !value)}
              onSettings={() => {
                setPanel("settings");
                setExpanded(false);
                setDetailPanel("computer");
              }}
              onClose={closePanel}
            />
          )}
        </>
      }
    >
      {view === "usage" ? (
        <UsageSurface />
      ) : (
        <>
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
              {
                "--composer-dock-height": `${dock.height}px`,
                "--bot-color": characterIdentity(bot.avatar).color,
              } as CSSProperties
            }
          >
            <ChatHeader
              bot={bot}
              busy={Boolean(chat.view?.busy)}
              detailsOpen={detailsOpen && panel === "settings"}
              computerOpen={computerOpen}
              context={
                <ContextRing
                  botId={bot.id}
                  state={chat.view?.runtime}
                  provider={engine.profile?.config.provider ?? "pi"}
                  busy={Boolean(chat.view?.busy)}
                />
              }
              modelSelector={
                <EngineSelector
                  botId={bot.id}
                  setup={engine}
                  model={chat.view?.model ?? null}
                  connected={chat.connected}
                  onConfigure={() => settings.open("providers", bot.id)}
                />
              }
              onDetails={() => showPanel("root")}
              onComputer={showComputer}
            />
            <span className="sr-only" role="status">
              {connection}
            </span>
            <Messages
              botId={bot.id}
              ready={Boolean(chat.view)}
              busy={Boolean(chat.view?.busy)}
              botName={bot.name}
              createdAt={bot.createdAt}
              items={items}
              sentRequest={chat.sentRequest}
              onResend={resend}
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
                    (computer.status.capabilities.files ||
                      computer.status.scope),
                )}
                onComputerRequired={() => {
                  setPanel("settings");
                  setExpanded(false);
                  setDetailPanel("computer");
                  setDetailsOpen(true);
                }}
                status={
                  <>
                    <RuntimeStatus
                      state={chat.view.runtime}
                      onDraft={(text) => draft.update({ text })}
                    />
                    {!!chat.view.approvals?.length && (
                      <Approvals
                        botId={bot.id}
                        approvals={chat.view.approvals}
                      />
                    )}
                  </>
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
        </>
      )}
    </Workspace>
  );
}
