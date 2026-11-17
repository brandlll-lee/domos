import type { Bot, BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { PanelDialog } from "@domos/ui/dialog";
import { ActionMenu } from "@domos/ui/menu";
import { ScrollArea } from "@domos/ui/scroll-area";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { RobotIcon } from "@phosphor-icons/react/dist/csr/Robot";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { type RefObject, useEffect, useRef, useState } from "react";
import { CreateBot } from "../bots/create-bot.tsx";
import { useAttention } from "./attention.tsx";
import { TeamAvatar } from "./bot-reference.tsx";
import { chatCopy } from "./copy.ts";
import { contactTime } from "./format.ts";
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
  connected: boolean;
  onBotCreated: (bot: Bot) => void;
  onSelect: () => void;
  compact: boolean;
  onSearch: () => void;
  searchTrigger: RefObject<HTMLButtonElement | null>;
}) {
  const createTrigger = useRef<HTMLButtonElement>(null);
  const [creation, setCreation] = useState<"bot" | "team">();
  const attention = useAttention();
  const currentChat = window.location.hash.startsWith("#team/")
    ? window.location.hash.slice(1)
    : `bot/${selected.id}`;
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
            >
              <PlusIcon />
            </Button>
          }
          items={[
            {
              label: "新建 Bot",
              icon: <RobotIcon />,
              onSelect: () => setCreation("bot"),
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
            bots.map((bot) => (
              <PanelDialog.Close
                className="contact-row"
                key={bot.id}
                render={<a href={`#bot/${bot.id}`} />}
                onClick={onSelect}
                onPointerEnter={() => prefetchChat(bot.id)}
                onFocus={() => prefetchChat(bot.id)}
                aria-label={bot.name}
                title={compact ? bot.name : undefined}
                aria-current={
                  !window.location.hash.startsWith("#team/") &&
                  bot.id === selected.id
                    ? "page"
                    : undefined
                }
              >
                <BotAvatar
                  botId={bot.id}
                  interactive
                  seed={bot.avatar}
                  state={connected && bot.busy ? "running" : "idle"}
                  statusLabel={chatCopy.botWorking}
                  unread={attention?.counts[`bot/${bot.id}`]}
                />
                <div className="chat-preview">
                  <strong>{bot.name}</strong>
                  {bot.lastMessageAt !== undefined && (
                    <time
                      dateTime={new Date(bot.lastMessageAt).toISOString()}
                      title={new Date(bot.lastMessageAt).toLocaleString()}
                    >
                      {contactTime(bot.lastMessageAt, now)}
                    </time>
                  )}
                  <span>
                    {contactPreview(connected ? bot : { ...bot, busy: false })}
                  </span>
                </div>
              </PanelDialog.Close>
            ))
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
