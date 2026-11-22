import type { Bot, BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { PanelDialog } from "@domos/ui/dialog";
import { ActionMenu } from "@domos/ui/menu";
import { ScrollArea } from "@domos/ui/scroll-area";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { RobotIcon } from "@phosphor-icons/react/dist/csr/Robot";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { type RefObject, useEffect, useRef, useState } from "react";
import { prepareCharacters } from "../bots/character-state.ts";
import { CreateBot } from "../bots/create-bot.tsx";
import { useWorkAction } from "../bots/details/use-bot-work.ts";
import { useErrorNotice } from "../notices.tsx";
import { saveWorkspaceView, workspaceView } from "../shell/workspace-state.ts";
import { useAttention } from "./attention.tsx";
import { TeamAvatar } from "./bot-reference.tsx";
import {
  ConversationState,
  ConversationsDialog,
  conversationRoute,
  createConversation,
} from "./conversations.tsx";
import { chatCopy } from "./copy.ts";
import { TeamDialog } from "./team-dialog.tsx";
import { prefetchChat } from "./use-chat.ts";

export const selectTeam = (team: Team) => {
  window.location.hash = `team/${team.id}`;
};

export const contactPreview = (bot: BotPresence) =>
  bot.busy ? chatCopy.working : bot.preview || "开始对话";

export function Sidebar({
  bots,
  teams,
  onTeamsChange,
  selected,
  conversationId,
  connected,
  onBotCreated,
  onSelect,
  compact,
  onSearch,
  searchTrigger,
}: {
  bots: BotPresence[];
  teams: Team[];
  onTeamsChange: (teams: Team[]) => void;
  selected: Bot;
  conversationId: number;
  connected: boolean;
  onBotCreated: (bot: Bot) => void;
  onSelect: () => void;
  compact: boolean;
  onSearch: () => void;
  searchTrigger: RefObject<HTMLButtonElement | null>;
}) {
  const [expanded, setExpanded] = useState(() => workspaceView().expandedBots);
  const [showAll, setShowAll] = useState<Record<number, boolean>>({});
  const [browsing, setBrowsing] = useState<number>();
  const browsingBot = bots.find((bot) => bot.id === browsing);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const [creation, setCreation] = useState<"bot" | "team">();
  const action = useWorkAction();
  useErrorNotice(action.error);
  const attention = useAttention();
  const currentChat = window.location.hash.startsWith("#team/")
    ? window.location.hash.slice(1)
    : conversationRoute(selected.id, conversationId);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <aside className="sidebar" data-compact={compact || undefined}>
      <div className="sidebar-toolbar">
        <span className="sidebar-heading">Bots</span>
        <ActionMenu
          label="新建"
          trigger={
            <Button
              ref={createTrigger}
              variant="ghost"
              size="icon-small"
              aria-label="新建"
              pending={action.busy}
            >
              <PlusIcon />
            </Button>
          }
          items={[
            {
              label: "新建 Bot",
              icon: <RobotIcon />,
              onSelect: () => {
                void action.run("create-prepare", async () => {
                  await prepareCharacters();
                  setCreation("bot");
                });
              },
            },
            {
              label: "新建团队",
              icon: <UsersThreeIcon />,
              onSelect: () => setCreation("team"),
            },
          ]}
        />
        <Button
          ref={searchTrigger}
          variant="ghost"
          size="icon-small"
          aria-label={chatCopy.search}
          title={chatCopy.search}
          aria-haspopup="dialog"
          onClick={onSearch}
        >
          <MagnifyingGlass />
        </Button>
        <ActionMenu
          label="提醒设置"
          trigger={
            <Button variant="ghost" size="icon-small" aria-label="提醒设置">
              <BellIcon />
            </Button>
          }
          items={[
            {
              label: attention?.preferences.muted[currentChat]
                ? "开启当前聊天提醒"
                : "静音当前聊天",
              onSelect: () => attention?.mute(currentChat),
            },
            {
              label: attention?.preferences.silent
                ? "开启所有提醒"
                : "暂停所有提醒",
              onSelect: () => attention?.mute(),
            },
          ]}
        />
      </div>
      <ScrollArea className="sidebar-scroll">
        <nav aria-label={chatCopy.conversations}>
          {bots.length ? (
            bots.map((bot) => {
              const sessions = bot.conversations ?? [];
              const active =
                !currentChat.startsWith("team/") && bot.id === selected.id;
              const current = active
                ? conversationId
                : (workspaceView().conversations[String(bot.id)] ?? bot.id);
              const target =
                sessions.find(
                  (item) => item.id === current && !item.archived,
                ) ?? sessions.find((item) => item.id === bot.id);
              const preview =
                target?.id === bot.id && bot.lastMessageAt && bot.preview
                  ? bot.preview
                  : target?.title;
              const visible = sessions
                .filter(
                  (item) =>
                    !item.archived ||
                    (active && item.id === current) ||
                    item.status === "working" ||
                    item.status === "waiting" ||
                    item.status === "queued",
                )
                .map((item) => ({
                  item,
                  unread:
                    attention?.counts[conversationRoute(bot.id, item.id)] ?? 0,
                  status: connected ? item.status : ("idle" as const),
                }));
              const priority = visible.filter(
                (row) => row.status !== "idle" || row.unread > 0,
              );
              const idle = visible.filter(
                (row) => row.status === "idle" && row.unread === 0,
              );
              const recent = idle.slice(0, 3);
              const activeIdle =
                active && idle.find((row) => row.item.id === current);
              if (activeIdle && !recent.includes(activeIdle))
                recent[2] = activeIdle;
              const extra = idle.length - recent.length;
              const all = showAll[bot.id];
              const open = expanded[bot.id] ?? active;
              const parentCurrent =
                active &&
                (compact ||
                  !open ||
                  !visible.some((row) => row.item.id === current))
                  ? "page"
                  : undefined;
              const listId = `bot-${bot.id}-conversations`;
              const toggle = (nextOpen: boolean) => {
                if (nextOpen === open) return;
                const next = { ...expanded, [bot.id]: nextOpen };
                setExpanded(next);
                saveWorkspaceView({ expandedBots: next });
              };
              const unread = sessions.reduce(
                (total, item) =>
                  total +
                  (attention?.counts[conversationRoute(bot.id, item.id)] ?? 0),
                0,
              );
              const avatar = (
                <BotAvatar
                  botId={bot.id}
                  interactive
                  seed={bot.avatar}
                  state={connected && bot.busy ? "running" : "idle"}
                  statusLabel={chatCopy.botWorking}
                  unread={unread}
                />
              );
              const create = () =>
                void action.run(["conversation", bot.id], (requestId) =>
                  createConversation(bot.id, current, requestId),
                );
              return (
                <div key={bot.id} className="bot-conversations">
                  <div className="bot-contact-heading">
                    <PanelDialog.Close
                      className="contact-row"
                      render={<a href={`#bot/${bot.id}`} />}
                      onClick={onSelect}
                      onPointerEnter={() => prefetchChat(target?.id ?? bot.id)}
                      onFocus={() => prefetchChat(target?.id ?? bot.id)}
                      aria-label={bot.name}
                      tabIndex={compact ? -1 : undefined}
                      aria-hidden={compact || undefined}
                      aria-current={compact ? undefined : parentCurrent}
                    >
                      {avatar}
                      <div className="chat-preview">
                        <strong>{bot.name}</strong>
                        {preview && <span>{preview}</span>}
                      </div>
                    </PanelDialog.Close>
                    {compact && (
                      <ActionMenu
                        label={bot.name}
                        trigger={
                          <Button
                            variant="ghost"
                            className="conversation-switcher"
                            title={bot.name}
                            aria-label={bot.name}
                            aria-current={parentCurrent}
                          />
                        }
                        items={[
                          ...[...priority, ...recent].map(({ item }) => ({
                            label: item.title,
                            onSelect: () => {
                              window.location.hash = `bot/${bot.id}/${item.id}`;
                              onSelect();
                            },
                          })),
                          { label: "新建会话", onSelect: create },
                          {
                            label: "管理会话",
                            onSelect: () => setBrowsing(bot.id),
                          },
                        ]}
                      />
                    )}
                    {sessions.length > 0 && (
                      <Button
                        className="conversation-toggle"
                        variant="ghost"
                        size="icon-small"
                        aria-label={`${bot.name}的会话`}
                        aria-expanded={open}
                        aria-controls={open && !compact ? listId : undefined}
                        tabIndex={compact ? -1 : undefined}
                        aria-hidden={compact || undefined}
                        onClick={() => toggle(!open)}
                        onKeyDown={(event) => {
                          if (
                            event.key !== "ArrowRight" &&
                            event.key !== "ArrowLeft"
                          )
                            return;
                          event.preventDefault();
                          toggle(event.key === "ArrowRight");
                        }}
                      >
                        <CaretDownIcon />
                      </Button>
                    )}
                    {!compact && (
                      <div className="bot-contact-actions">
                        <Button
                          variant="ghost"
                          size="icon-small"
                          aria-label={`为 ${bot.name} 新建会话`}
                          className="bot-create-action"
                          title="新建会话"
                          pending={action.busy}
                          onClick={create}
                        >
                          <PlusIcon />
                        </Button>
                        <ActionMenu
                          label={`${bot.name} 的操作`}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon-small"
                              aria-label={`${bot.name} 的操作`}
                            >
                              <DotsThreeIcon />
                            </Button>
                          }
                          items={[
                            {
                              label: "新建会话",
                              onSelect: create,
                              disabled: action.busy,
                            },
                            {
                              label: "管理会话",
                              onSelect: () => setBrowsing(bot.id),
                            },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                  {open && visible.length > 0 && (
                    <nav
                      id={listId}
                      className="conversation-children"
                      aria-label={`${bot.name}的会话列表`}
                      inert={compact}
                    >
                      {[...priority, ...(all ? idle : recent)].map(
                        ({ item, status, unread }) => (
                          <PanelDialog.Close
                            key={item.id}
                            className="conversation-row"
                            render={<a href={`#bot/${bot.id}/${item.id}`} />}
                            onClick={onSelect}
                            onPointerEnter={() => prefetchChat(item.id)}
                            onFocus={() => prefetchChat(item.id)}
                            aria-current={
                              !compact && active && item.id === current
                                ? "page"
                                : undefined
                            }
                          >
                            <span className="conversation-row-title">
                              {item.title}
                            </span>
                            <ConversationState
                              status={status}
                              updatedAt={item.updatedAt}
                              unread={unread}
                              now={now}
                            />
                          </PanelDialog.Close>
                        ),
                      )}
                      {extra > 0 && (
                        <Button
                          variant="ghost"
                          size="small"
                          className="conversation-more"
                          aria-expanded={Boolean(all)}
                          onClick={() =>
                            setShowAll({ ...showAll, [bot.id]: !all })
                          }
                        >
                          {all ? "收起其余会话" : `展开其余 ${extra} 条`}
                        </Button>
                      )}
                    </nav>
                  )}
                </div>
              );
            })
          ) : (
            <p className="sidebar-empty" role="status">
              {chatCopy.searchEmpty}
            </p>
          )}
          {teams.map((team) => (
            <PanelDialog.Close
              className="contact-row"
              key={team.id}
              render={<a href={`#team/${team.id}`} />}
              onClick={onSelect}
              aria-current={
                window.location.hash === `#team/${team.id}` ? "page" : undefined
              }
            >
              <TeamAvatar
                members={bots.filter((bot) => team.members.includes(bot.id))}
                unread={attention?.counts[`team/${team.id}`]}
              />
              <div className="chat-preview">
                <strong>{team.name}</strong>
                <span>{team.purpose || `${team.members.length} 位 Bot`}</span>
              </div>
            </PanelDialog.Close>
          ))}
        </nav>
      </ScrollArea>
      {browsingBot && (
        <ConversationsDialog
          bot={browsingBot}
          current={
            browsingBot.id === selected.id
              ? conversationId
              : (workspaceView().conversations[String(browsingBot.id)] ??
                browsingBot.id)
          }
          open
          onOpenChange={(open) => {
            if (!open) setBrowsing(undefined);
          }}
        />
      )}
      <CreateBot
        finalFocus={() => createTrigger.current}
        open={creation === "bot"}
        onOpenChange={(open) => setCreation(open ? "bot" : undefined)}
        onCreated={onBotCreated}
      />
      <TeamDialog
        finalFocus={() => createTrigger.current}
        open={creation === "team"}
        onOpenChange={(open) => setCreation(open ? "team" : undefined)}
        bots={bots}
        onSaved={(team) => {
          onTeamsChange([...teams, team]);
          selectTeam(team);
        }}
      />
    </aside>
  );
}
