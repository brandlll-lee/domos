import type { Bot, BotPresence } from "@domos/agent/bots";
import { type ChatMessage, messageText } from "@domos/agent/messages";
import { characterIdentity } from "@domos/ui/characters";
import { Button } from "@domos/ui/controls";
import { layout } from "@domos/ui/tokens";
import {
  type CSSProperties,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppsCenter } from "../apps/center.tsx";
import { CreateBot } from "../bots/create-bot.tsx";
import { BotDetails, type BotPanelView } from "../bots/details/index.tsx";
import { selectBot, useBots } from "../bots/use-bots.ts";
import { useComputer } from "../computer/use-computer.ts";
import { useSettings } from "../settings/context.ts";
import { Workspace } from "../shell/workspace.tsx";
import { UsageSurface } from "../usage/page.tsx";
import { Composer } from "./composer.tsx";
import { ContextRing } from "./context.tsx";
import { chatCopy } from "./copy.ts";
import { ErrorMessage } from "./error-message.tsx";
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
  const computer = useComputer(bot.id, directory);
  const dock = useComposerDock();
  const draft = useDraft(bot.id);
  const input = useRef<HTMLTextAreaElement>(null);
  const resend = useCallback(
    (original: ChatMessage) => {
      draft.update({
        text: messageText(original),
        attachments: original.attachments ?? [],
        materials: original.materials ?? { skills: [], context: [] },
        pending: null,
      });
      input.current?.focus();
    },
    [draft.update],
  );
  const [view, setView] = useState<"chat" | "usage">("chat");
  const [appsOpen, setAppsOpen] = useState(false);
  const [detailsOpen, updateDetailsOpen] = useState(
    () =>
      window.innerWidth >=
      layout.sidebar.min + layout.chatMin + layout.inspector.min,
  );
  const setDetailsOpen = useCallback(
    (open: boolean) => startTransition(() => updateDetailsOpen(open)),
    [],
  );
  const [workRun, setWorkRun] = useState<string>();
  const [panel, setPanel] = useState<
    "settings" | "computer" | "browser" | "work"
  >("settings");
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ botId: number; turnId: string }>)
        .detail;
      if (detail.botId !== bot.id) return;
      setWorkRun(detail.turnId);
      setDetailPanel("root");
      setPanel("work");
      setDetailsOpen(true);
    };
    window.addEventListener("domos:work-open", open);
    return () => window.removeEventListener("domos:work-open", open);
  }, [bot.id, setDetailsOpen]);
  const [expanded, setExpanded] = useState(false);
  const [detailPanel, setDetailPanel] = useState<BotPanelView>("root");
  const [takeover, setTakeover] = useState<{
    id: string;
    service: "browser" | "desktop";
  }>();
  useEffect(() => {
    const open = (event: Event) => {
      const request = (
        event as CustomEvent<{
          botId: number;
          id: string;
          service: "browser" | "desktop";
        }>
      ).detail;
      if (request.botId !== bot.id) return;
      setTakeover(request);
      setView("chat");
      setDetailPanel("root");
      setExpanded(false);
      setPanel(request.service === "browser" ? "browser" : "computer");
      setDetailsOpen(true);
    };
    window.addEventListener("domos:takeover-open", open);
    return () => window.removeEventListener("domos:takeover-open", open);
  }, [bot.id, setDetailsOpen]);
  const takeoverId =
    panel === (takeover?.service === "browser" ? "browser" : "computer") &&
    chat.view?.approvals?.some((approval) => approval.id === takeover?.id)
      ? takeover?.id
      : undefined;
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
    setView("chat");
    setPanel("settings");
    setExpanded(false);
    setDetailPanel(view);
    setDetailsOpen(true);
  };
  const closePanel = () => {
    setDetailsOpen(false);
    setExpanded(false);
  };
  return (
    <Workspace
      onApps={() => setAppsOpen(true)}
      detailsOpen={detailsOpen}
      obscured={settings.showing || appsOpen}
      onDetailsChange={(open) => {
        if (open) setDetailsOpen(true);
        else closePanel();
      }}
      expanded={panel !== "settings" && expanded}
      inspectorTitle="Bot详情"
      usageOpen={view === "usage"}
      onUsage={() => {
        setView(view === "usage" ? "chat" : "usage");
        closePanel();
      }}
      onSettings={() => settings.open("general", bot.id)}
      sidebar={(compact, expand) => (
        <Sidebar
          compact={compact}
          onExpand={expand}
          bots={bots}
          selected={bot}
          connected={directoryConnected}
          actions={<CreateBot onCreated={selectBot} />}
          onSelect={() => setView("chat")}
        />
      )}
      inspector={
        <BotDetails
          takeoverId={takeoverId}
          active={detailsOpen}
          workRun={workRun}
          bot={bot}
          view={detailPanel}
          onViewChange={setDetailPanel}
          onClose={closePanel}
          computer={computer}
          chat={{
            ...chat,
            model: chat.view?.model ?? null,
            busy: Boolean(chat.view?.busy),
          }}
          context={
            <ContextRing
              botId={bot.id}
              state={chat.view?.runtime}
              provider={chat.view?.engine?.provider}
              busy={Boolean(chat.view?.busy)}
            />
          }
          canManage={settings.admin}
          tab={panel === "settings" ? "bot" : panel}
          onTabChange={(tab) => {
            setPanel(tab === "bot" ? "settings" : tab);
            setExpanded(false);
          }}
          expanded={expanded}
          onExpand={() => startTransition(() => setExpanded((value) => !value))}
        />
      }
    >
      <AppsCenter
        open={appsOpen}
        onOpenChange={setAppsOpen}
        bots={bots}
        computers={directory.computers.items}
      />
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
              detailsOpen={detailsOpen}
              provider={chat.view?.engine?.provider}
              onDetails={() => showPanel("root")}
            />
            <span className="sr-only" role="status">
              {connection}
            </span>
            <Messages
              botId={bot.id}
              ready={Boolean(chat.view) || Boolean(chat.error)}
              busy={Boolean(chat.view?.busy)}
              processing={Boolean(chat.view?.processing)}
              retry={chat.view?.busy ? chat.view.runtime?.retry : null}
              botName={bot.name}
              createdAt={bot.createdAt}
              items={items}
              sentRequest={chat.sentRequest}
              hasMore={Boolean(chat.view?.before)}
              loadingEarlier={chat.loadingEarlier}
              onEarlier={chat.loadEarlier}
              onResend={resend}
              welcome={
                !chat.error &&
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
                messages={chat.view.messages}
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
                  setPanel("computer");
                  setExpanded(false);
                  setDetailPanel("computer");
                  setDetailsOpen(true);
                }}
                status={
                  <RuntimeStatus
                    state={chat.view.runtime}
                    onDraft={(text) => draft.update({ text })}
                  />
                }
              />
            ) : (
              error && (
                <div>
                  <ErrorMessage>{error}</ErrorMessage>
                  <Button
                    variant="secondary"
                    onClick={() => window.location.reload()}
                  >
                    重新连接
                  </Button>
                </div>
              )
            )}
          </main>
        </>
      )}
    </Workspace>
  );
}
