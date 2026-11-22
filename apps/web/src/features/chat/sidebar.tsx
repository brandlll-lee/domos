import type { Bot, BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { PanelDialog } from "@domos/ui/dialog";
import { ActionMenu } from "@domos/ui/menu";
import { ScrollArea } from "@domos/ui/scroll-area";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
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
              const current =
                bot.id === selected.id
                  ? conversationId
                  : (workspaceView().conversations[String(bot.id)] ?? bot.id);
              const visible = sessions.filter(
                (item) =>
                  !item.archived ||
                  (item.id === current && bot.id === selected.id) ||
                  item.status === "working" ||
                  item.status === "waiting" ||
                  item.status === "queued",
              );
              const recent = visible
                .filter((item) => item.status === "idle")
                .slice(0, 3);
              const rows = visible.filter(
                (item) =>
                  recent.includes(item) ||
                  item.id === current ||
                  item.status !== "idle" ||
                  (attention?.counts[conversationRoute(bot.id, item.id)] ?? 0) >
                    0,
              );
              const open = expanded[bot.id] ?? bot.id === selected.id;
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
                      onPointerEnter={() => prefetchChat(current)}
                      onFocus={() => prefetchChat(current)}
                      aria-label={bot.name}
                      tabIndex={compact ? -1 : undefined}
                      aria-hidden={compact || undefined}
                      aria-current={
                        !window.location.hash.startsWith("#team/") &&
                        bot.id === selected.id
                          ? "page"
                          : undefined
                      }
                    >
                      {avatar}
                      <div className="chat-preview">
                        <strong>{bot.name}</strong>
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
                          />
                        }
                        items={[
                          ...rows.map((item) => ({
                            label: item.title,
                            onSelect: () => {
                              window.location.hash = `bot/${bot.id}/${item.id}`;
                              onSelect();
                            },
                          })),
                          { label: "新建会话", onSelect: create },
                          {
                            label: "查看全部会话",
                            onSelect: () => setBrowsing(bot.id),
                          },
                        ]}
                      />
                    )}
                    <div className="bot-conversation-actions" inert={compact}>
                      <Button
                        variant="ghost"
                        size="icon-small"
                        aria-label={`${bot.name}的会话`}
                        aria-expanded={open}
                        onClick={() => {
                          const next = { ...expanded, [bot.id]: !open };
                          setExpanded(next);
                          saveWorkspaceView({ expandedBots: next });
                        }}
                      >
                        <CaretDownIcon
                          style={{
                            transform: open ? undefined : "rotate(-90deg)",
                          }}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-small"
                        aria-label={`为${bot.name}新建会话`}
                        pending={action.busy}
                        onClick={create}
                      >
                        <PlusIcon />
                      </Button>
                    </div>
                  </div>
                  {open && (
                    <nav
                      className="conversation-children"
                      aria-label={`${bot.name}的会话列表`}
                      inert={compact}
                    >
                      {rows.map((item) => (
                        <PanelDialog.Close
                          key={item.id}
                          className="conversation-row"
                          render={<a href={`#bot/${bot.id}/${item.id}`} />}
                          onClick={onSelect}
                          onPointerEnter={() => prefetchChat(item.id)}
                          aria-current={
                            currentChat === conversationRoute(bot.id, item.id)
                              ? "page"
                              : undefined
                          }
                        >
                          <span className="conversation-row-title">
                            {item.title}
                          </span>
                          <ConversationState
                            item={
                              connected ? item : { ...item, status: "idle" }
                            }
                            unread={
                              attention?.counts[
                                conversationRoute(bot.id, item.id)
                              ] ?? 0
                            }
                            now={now}
                          />
                        </PanelDialog.Close>
                      ))}
                      <Button
                        variant="ghost"
                        size="small"
                        className="conversation-more"
                        onClick={() => setBrowsing(bot.id)}
                      >
                        查看全部会话
                      </Button>
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
