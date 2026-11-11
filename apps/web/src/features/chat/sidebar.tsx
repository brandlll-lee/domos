import type { Bot, BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { PanelDialog } from "@domos/ui/dialog";
import { SearchField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { ScrollArea } from "@domos/ui/scroll-area";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { RobotIcon } from "@phosphor-icons/react/dist/csr/Robot";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { useEffect, useRef, useState } from "react";
import { CreateBot } from "../bots/create-bot.tsx";
import { TeamAvatar } from "./bot-reference.tsx";
import { chatCopy } from "./copy.ts";
import { contactTime } from "./format.ts";
import { TeamDialog } from "./team-dialog.tsx";
import { prefetchChat } from "./use-chat.ts";

export const selectTeam = (team: Team) => {
  window.location.hash = `team/${team.id}`;
};

const contactPreview = (bot: BotPresence) =>
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
  onExpand,
}: {
  bots: BotPresence[];
  teams: Team[];
  onTeamsChange: (teams: Team[]) => void;
  selected: Bot;
  connected: boolean;
  onBotCreated: (bot: Bot) => void;
  onSelect: () => void;
  compact: boolean;
  onExpand: () => void;
}) {
  const createTrigger = useRef<HTMLButtonElement>(null);
  const [creation, setCreation] = useState<"bot" | "team">();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  useEffect(() => {
    if (!compact && focusSearch.current) {
      search.current?.focus();
      focusSearch.current = false;
    }
  }, [compact]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const matches = bots.filter((bot) =>
    `${bot.name}\n${contactPreview(bot)}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <aside className="sidebar" data-compact={compact || undefined}>
      <div className="sidebar-toolbar">
        {compact && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={chatCopy.search}
            title={chatCopy.search}
            onClick={() => {
              focusSearch.current = true;
              onExpand();
            }}
          >
            <MagnifyingGlass />
          </Button>
        )}
        <SearchField
          className="sidebar-search"
          hidden={compact}
          inputRef={search}
          aria-label={chatCopy.search}
          placeholder="搜索"
          value={query}
          onValueChange={setQuery}
        />
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
      </div>
      <ScrollArea className="sidebar-scroll">
        <nav aria-label={chatCopy.conversations}>
          {matches.length ? (
            matches.map((bot) => (
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
                  interactive
                  seed={bot.avatar}
                  state={connected && bot.busy ? "running" : "idle"}
                  statusLabel={chatCopy.botWorking}
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
                  <span>{contactPreview(bot)}</span>
                </div>
              </PanelDialog.Close>
            ))
          ) : (
            <p className="sidebar-empty" role="status">
              {chatCopy.searchEmpty}
            </p>
          )}
          {teams
            .filter((team) =>
              `${team.name} ${team.purpose}`
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .map((team) => (
              <PanelDialog.Close
                className="contact-row"
                key={team.id}
                render={<a href={`#team/${team.id}`} />}
                onClick={onSelect}
                aria-current={
                  window.location.hash === `#team/${team.id}`
                    ? "page"
                    : undefined
                }
              >
                <TeamAvatar
                  members={bots.filter((bot) => team.members.includes(bot.id))}
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
      {!connected && (
        <p className="sidebar-empty" role="status">
          正在连接…
        </p>
      )}
    </aside>
  );
}
