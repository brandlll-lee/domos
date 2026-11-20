import type { Attachment } from "@domos/agent/attachments";
import type { Bot, BotPresence } from "@domos/agent/bots";
import { type ChatMessage, messageText } from "@domos/agent/messages";
import type { Team } from "@domos/agent/teams";
import { AvatarMediaContext } from "@domos/ui/avatar";
import { characterIdentity } from "@domos/ui/characters";
import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { layout } from "@domos/ui/tokens";
import {
  addTransitionType,
  type ComponentProps,
  type CSSProperties,
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppsCenter } from "../apps/center.tsx";
import { BotDetails, type BotPanelView } from "../bots/details/index.tsx";
import { selectBot, useBots } from "../bots/use-bots.ts";
import { useComputer } from "../computer/use-computer.ts";
import { FilePreviewContext } from "../files/context.tsx";
import { FilePanel } from "../files/panel.tsx";
import { useErrorNotice } from "../notices.tsx";
import { useSettings } from "../settings/context.ts";
import { Workspace } from "../shell/workspace.tsx";
import { saveWorkspaceView, workspaceView } from "../shell/workspace-state.ts";
import { ChatAttentionProvider, consumeChatTarget } from "./attention.tsx";
import { TeamMembers } from "./bot-reference.tsx";
import { Composer } from "./composer.tsx";
import { ContextRing } from "./context.tsx";
import { chatCopy } from "./copy.ts";
import { ChatHeader } from "./header.tsx";
import { Messages } from "./messages.tsx";
import { RuntimeStatus } from "./runtime.tsx";
import { SearchDialog } from "./search-dialog.tsx";
import { Sidebar } from "./sidebar.tsx";
import { TeamDetails } from "./team-details.tsx";
import { useChat } from "./use-chat.ts";
import { useComposerDock } from "./use-composer-dock.ts";
import { useDraft } from "./use-draft.ts";
import { useHistorySearch } from "./use-history-search.ts";
import { ChatWelcome } from "./welcome.tsx";
import { useWorkspaceAvatars } from "./workspace-avatars.ts";

const UsageSurface = lazy(() =>
  import("../usage/page.tsx").then((module) => ({
    default: module.UsageSurface,
  })),
);

export function ChatPage() {
  const bots = useBots();
  const search = useHistorySearch();
  const avatars = useWorkspaceAvatars(
    bots.selected,
    bots.items,
    bots.teams,
    bots.selectedTeam,
  );
  if (!bots.selected)
    return bots.error ? null : <Loading label="正在读取联系人" />;
  return (
    <AvatarMediaContext
      value={Object.fromEntries(
        bots.items.flatMap((bot) =>
          bot.avatarMedia ? [[bot.id, bot.avatarMedia]] : [],
        ),
      )}
    >
      <ChatAttentionProvider>
        <BotChat
          key={bots.selectedTeam?.id ?? bots.selected.id}
          team={bots.selectedTeam}
          bot={bots.selected}
          bots={bots.items}
          directoryError={bots.error}
          directoryConnected={bots.connected}
          directory={bots}
          search={search}
          avatars={avatars}
        />
      </ChatAttentionProvider>
    </AvatarMediaContext>
  );
}

function BotChat({
  team,
  bot,
  bots,
  directoryError,
  directoryConnected,
  directory,
  search,
  avatars,
}: {
  team?: Team;
  bot: Bot;
  bots: BotPresence[];
  directoryError: string | null;
  directoryConnected: boolean;
  directory: ReturnType<typeof useBots>;
  search: ReturnType<typeof useHistorySearch>;
  avatars: ReturnType<typeof useWorkspaceAvatars>;
}) {
  const members = useMemo(
    () =>
      team
        ? bots.filter((member) => team.members.includes(member.id))
        : undefined,
    [bots, team],
  );
  const referenceBots = useMemo(
    () => members ?? bots.filter((member) => member.id !== bot.id),
    [members, bots, bot.id],
  );
  const settings = useSettings();
  const chatKey = team ? `team:${team.id}` : String(bot.id);
  const [savedPanel] = useState(() => workspaceView().panels[chatKey]);
  const chat = useChat(bot.id, () => settings.open("ai", bot.id), team?.id);
  const [navigationError, setNavigationError] = useState("");
  const navigation = useRef(chat);
  navigation.current = chat;
  const navigationReady = Boolean(chat.view) && !chat.restoring;
  const dock = useComposerDock();
  const draft = useDraft(team ? `team:${team.id}` : bot.id);
  const [sessionId, setSessionId] = useState<number>();
  const [member, setMember] = useState<BotPresence>();
  const sessionOwner =
    member ??
    bots.find(
      (item) =>
        item.id ===
        (chat.view?.messages.find((message) => message.sessionId === sessionId)
          ?.author?.botId ??
          chat.view?.delegations?.find((item) => item.session === sessionId)
            ?.recipient),
    ) ??
    bot;
  const detailBot = sessionId
    ? { ...sessionOwner, id: sessionId as Bot["id"] }
    : sessionOwner;
  const computer = useComputer(sessionOwner.id, directory);
  const input = useRef<HTMLDivElement>(null);
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
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const [appsOpen, setAppsOpen] = useState(false);
  const [detailsOpen, updateDetailsOpen] = useState(
    () =>
      savedPanel?.open ??
      window.innerWidth >=
        layout.sidebar.min + layout.chatMin + layout.inspector.min,
  );
  const setDetailsOpen = useCallback(
    (open: boolean) =>
      startTransition(() => {
        addTransitionType("panel-layout");
        updateDetailsOpen(open);
      }),
    [],
  );
  const [workRun, setWorkRun] = useState<string>();
  const [panel, setPanel] = useState<
    "settings" | "computer" | "browser" | "work" | "file"
  >(savedPanel?.tab ?? "settings");
  const [file, setFile] = useState<Attachment | undefined>(savedPanel?.file);
  const [fileBotId, setFileBotId] = useState(
    savedPanel?.fileBotId ?? (bot.id as number),
  );
  const [inlineFiles, setInlineFiles] = useState(new Set<string>());
  const [fileTarget, setFileTarget] = useState<HTMLElement | null>(null);
  const registerFile = useCallback((id: string, active: boolean) => {
    setInlineFiles((previous) => {
      const next = new Set(previous);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const openFile = useCallback(
    (file: Attachment, sourceBotId: number = bot.id) => {
      setFile(file);
      setFileBotId(sourceBotId);
      setPanel("file");
      setExpanded(false);
      setDetailsOpen(true);
    },
    [setDetailsOpen, bot.id],
  );
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ botId: number; turnId: string }>)
        .detail;
      if (
        detail.botId !== bot.id &&
        !chat.view?.messages.some(
          (message) => message.sessionId === detail.botId,
        ) &&
        !chat.view?.delegations?.some((item) => item.session === detail.botId)
      )
        return;
      setSessionId(detail.botId);
      setMember(undefined);
      setWorkRun(detail.turnId);
      setDetailPanel("root");
      setPanel("work");
      setDetailsOpen(true);
    };
    window.addEventListener("domos:work-open", open);
    return () => window.removeEventListener("domos:work-open", open);
  }, [bot.id, chat.view, setDetailsOpen]);
  const [expanded, setExpanded] = useState(false);
  const [detailPanel, setDetailPanel] = useState<BotPanelView>(
    savedPanel?.detail ?? "root",
  );
  useEffect(() => {
    if (!navigationReady) return;
    const open = () => {
      const target = consumeChatTarget(
        team ? `team/${team.id}` : `bot/${bot.id}`,
      );
      if (!target) return;
      setView("chat");
      setNavigationError("");
      if (
        target.turnId &&
        (!target.cursor || target.messageId.startsWith("failure:"))
      ) {
        setSessionId(target.sessionId);
        setMember(undefined);
        setWorkRun(target.turnId);
        setDetailPanel("root");
        setPanel("work");
        setDetailsOpen(true);
      } else {
        void navigation.current
          .revealMessage(target)
          .catch((cause: Error) => setNavigationError(cause.message));
      }
    };
    open();
    window.addEventListener("domos:chat-open", open);
    return () => window.removeEventListener("domos:chat-open", open);
  }, [bot.id, team, navigationReady, setDetailsOpen]);
  useEffect(() => {
    saveWorkspaceView({
      panels: {
        [chatKey]: {
          open: detailsOpen,
          tab: panel,
          detail: detailPanel,
          file,
          fileBotId,
        },
      },
    });
  }, [chatKey, detailsOpen, panel, detailPanel, file, fileBotId]);
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
      if (
        request.botId !== bot.id &&
        !chat.view?.messages.some(
          (message) => message.sessionId === request.botId,
        )
      )
        return;
      setSessionId(request.botId);
      setMember(undefined);
      setTakeover(request);
      setView("chat");
      setDetailPanel("root");
      setExpanded(false);
      setPanel(request.service === "browser" ? "browser" : "computer");
      setDetailsOpen(true);
    };
    window.addEventListener("domos:takeover-open", open);
    return () => window.removeEventListener("domos:takeover-open", open);
  }, [bot.id, chat.view, setDetailsOpen]);
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
    (navigationError || chat.error) ??
    directoryError ??
    (!items.some(
      (item) => item.kind === "notice" && item.status === "failed",
    ) && chat.view?.failed
      ? chatCopy.errors.reply
      : null);
  useErrorNotice(error);
  const showPanel = (view: BotPanelView) => {
    setMember(undefined);
    setSessionId(undefined);
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
  const selectedFile = panel === "file" && detailsOpen ? file?.id : undefined;
  const filePreview = useMemo(
    () => ({
      open: openFile,
      selected: selectedFile,
      inline: inlineFiles,
      register: registerFile,
      target: fileTarget,
    }),
    [openFile, selectedFile, inlineFiles, registerFile, fileTarget],
  );
  if (avatars.waiting)
    return avatars.failed ? (
      <Button onClick={avatars.retry}>头像读取失败，重试</Button>
    ) : (
      <Loading label="正在读取联系人" />
    );
  return (
    <FilePreviewContext value={filePreview}>
      <Workspace
        onApps={() => setAppsOpen(true)}
        detailsOpen={detailsOpen}
        obscured={settings.showing || appsOpen}
        onDetailsChange={(open) => {
          if (open) setDetailsOpen(true);
          else closePanel();
        }}
        expanded={panel !== "settings" && expanded}
        inspectorTitle={
          panel === "file"
            ? "文件预览"
            : team && !member
              ? "团队详情"
              : "Bot详情"
        }
        onUsage={() => {
          setView(view === "usage" ? "chat" : "usage");
          closePanel();
        }}
        onSettings={() => settings.open("general", bot.id)}
        sidebar={(compact) => (
          <Sidebar
            compact={compact}
            onSearch={() => setSearchOpen(true)}
            searchTrigger={searchTrigger}
            bots={bots}
            teams={directory.teams}
            onTeamsChange={directory.setTeams}
            selected={bot}
            connected={directoryConnected}
            onBotCreated={selectBot}
            onSelect={() => setView("chat")}
          />
        )}
        inspector={
          panel === "file" && file ? (
            <FilePanel
              botId={fileBotId}
              file={file}
              key={file.id}
              onBack={() => showPanel("files")}
              onClose={closePanel}
              onTarget={setFileTarget}
            />
          ) : team &&
            !member &&
            !sessionId &&
            (panel === "settings" || panel === "work") ? (
            <TeamDetails
              active={detailsOpen}
              team={team}
              members={members ?? []}
              bots={bots}
              onSaved={(saved) =>
                directory.setTeams((current) =>
                  current.map((item) => (item.id === saved.id ? saved : item)),
                )
              }
              chat={chat}
              tab={panel === "work" ? "work" : "team"}
              onTabChange={(tab) => {
                setSessionId(undefined);
                setPanel(tab === "work" ? "work" : "settings");
              }}
              onMember={(bot) => {
                setMember(bot);
                setSessionId(undefined);
                setDetailPanel("root");
                setPanel("settings");
              }}
              onClose={closePanel}
              workRun={workRun}
            />
          ) : (
            <MemberDetails
              member={member}
              onBack={
                team
                  ? () => {
                      setMember(undefined);
                      setSessionId(undefined);
                      setPanel("settings");
                      setDetailPanel("root");
                    }
                  : undefined
              }
              takeoverId={takeoverId}
              active={detailsOpen}
              workRun={workRun}
              bot={sessionOwner}
              sessionBot={detailBot}
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
              onShowMessage={async (item) => {
                if (!(await chat.revealMessage(item))) return;
                if (
                  window.innerWidth <
                  layout.sidebar.min + layout.chatMin + layout.inspector.min
                )
                  closePanel();
              }}
              tab={panel === "settings" || panel === "file" ? "bot" : panel}
              onTabChange={(tab) => {
                setPanel(tab === "bot" ? "settings" : tab);
                setExpanded(false);
              }}
              expanded={expanded}
              onExpand={() =>
                startTransition(() => {
                  addTransitionType("panel-layout");
                  setExpanded((value) => !value);
                })
              }
            />
          )
        }
      >
        <AppsCenter
          open={appsOpen}
          onOpenChange={setAppsOpen}
          bots={bots}
          computers={directory.computers.items}
        />
        {view === "usage" ? (
          <Suspense fallback={<Loading label="正在读取用量" />}>
            <UsageSurface />
          </Suspense>
        ) : (
          <TeamMembers value={referenceBots}>
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
                members={members}
                bot={team ? { ...bot, name: team.name } : bot}
                busy={chat.activity.length > 0}
                activity={chat.activity}
                stopping={chat.stopping}
                detailsOpen={detailsOpen}
                provider={chat.view?.engine?.provider}
                onDetails={() => showPanel("root")}
              />
              <span className="sr-only" role="status">
                {connection}
              </span>
              <Messages
                botId={bot.id}
                chatKey={chatKey}
                ready={
                  (Boolean(chat.view) || Boolean(chat.error)) && !chat.restoring
                }
                busy={chat.connected && Boolean(chat.view?.busy)}
                processing={chat.connected && chat.processing}
                activity={
                  chat.connected && (team || chat.view?.delegations?.length)
                    ? chat.view?.activity
                    : undefined
                }
                bots={bots}
                retry={chat.view?.busy ? chat.view.runtime?.retry : null}
                botName={team?.name ?? bot.name}
                createdAt={bot.createdAt}
                items={items}
                sentRequest={chat.sentRequest}
                target={chat.target}
                readingHistory={chat.readingHistory}
                obscured={settings.showing || appsOpen || view !== "chat"}
                onLatest={chat.showLatest}
                hasMore={chat.hasMore}
                hasNewer={chat.hasNewer}
                loadingNewer={chat.loadingNewer}
                newerError={chat.newerError}
                onNewer={chat.loadNewer}
                loadingEarlier={chat.loadingEarlier}
                earlierError={chat.earlierError}
                onEarlier={chat.loadEarlier}
                onResend={resend}
                welcome={
                  !team &&
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
                  members={referenceBots}
                  botName={team?.name ?? bot.name}
                  conversationId={team ? bot.id : chat.view.id}
                  connected={chat.connected}
                  busy={chat.connected && chat.view.busy}
                  sending={chat.sending}
                  stopping={chat.stopping}
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
                    chat.connected && (
                      <RuntimeStatus
                        state={chat.view.runtime}
                        onDraft={(text) => draft.update({ text })}
                      />
                    )
                  }
                />
              ) : null}
            </main>
          </TeamMembers>
        )}
      </Workspace>
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        trigger={searchTrigger}
        bots={bots}
        teams={directory.teams}
        search={search}
        onNavigate={() => setView("chat")}
      />
    </FilePreviewContext>
  );
}

function MemberDetails({
  member,
  ...props
}: ComponentProps<typeof BotDetails> & { member?: BotPresence }) {
  return member ? (
    <MemberBotDetails key={member.id} {...props} />
  ) : (
    <BotDetails {...props} />
  );
}

function MemberBotDetails(props: ComponentProps<typeof BotDetails>) {
  const chat = useChat(props.bot.id);
  return (
    <BotDetails
      {...props}
      chat={{
        ...chat,
        model: chat.view?.model ?? null,
        busy: Boolean(chat.view?.busy),
      }}
      context={
        <ContextRing
          botId={props.bot.id}
          state={chat.view?.runtime}
          provider={chat.view?.engine?.provider}
          busy={Boolean(chat.view?.busy)}
        />
      }
    />
  );
}
