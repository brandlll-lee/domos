import type { Bot, BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { PanelDialog } from "@domos/ui/dialog";
import { SearchField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { ActionMenu } from "@domos/ui/menu";
import { ScrollArea } from "@domos/ui/scroll-area";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { RobotIcon } from "@phosphor-icons/react/dist/csr/Robot";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { useEffect, useRef, useState } from "react";
import { CreateBot } from "../bots/create-bot.tsx";
import { openChatTarget, useAttention } from "./attention.tsx";
import { TeamAvatar } from "./bot-reference.tsx";
import { chatCopy } from "./copy.ts";
import { contactTime } from "./format.ts";
import { TeamDialog } from "./team-dialog.tsx";
import { prefetchChat } from "./use-chat.ts";
import type { useHistorySearch } from "./use-history-search.ts";

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
  searchState,
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
  searchState: ReturnType<typeof useHistorySearch>;
}) {
  const createTrigger = useRef<HTMLButtonElement>(null);
  const [creation, setCreation] = useState<"bot" | "team">();
  const { query, setQuery } = searchState;
  const attention = useAttention();
  const currentChat = window.location.hash.startsWith("#team/")
    ? window.location.hash.slice(1)
    : `bot/${selected.id}`;
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
          {query.trim() && <p className="sidebar-section">联系人</p>}
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
                  unread={attention?.counts[`team/${team.id}`]}
                />
                <div className="chat-preview">
                  <strong>{team.name}</strong>
                  <span>{team.purpose || `${team.members.length} 位 Bot`}</span>
                </div>
              </PanelDialog.Close>
            ))}
          {query.trim() && (
            <>
              <p className="sidebar-section">聊天记录</p>
              {searchState.items.map((item) => (
                <PanelDialog.Close
                  key={item.sequence}
                  className="contact-row search-result"
                  render={<Button variant="ghost" />}
                  aria-label={`${item.name}：${item.snippet}`}
                  onClick={() => {
                    onSelect();
                    openChatTarget(item);
                  }}
                >
                  <BotAvatar seed={item.avatar} />
                  <div className="chat-preview">
                    <strong>{item.name}</strong>
                    {!!item.timestamp && (
                      <time dateTime={new Date(item.timestamp).toISOString()}>
                        {contactTime(item.timestamp, now)}
                      </time>
                    )}
                    <span className="search-author">{item.author}</span>
                    <span className="search-snippet">{item.snippet}</span>
                  </div>
                </PanelDialog.Close>
              ))}
              {searchState.loading && <Loading label="正在搜索聊天记录" />}
              {!searchState.loading &&
                !searchState.error &&
                !searchState.items.length && (
                  <p className="sidebar-empty" role="status">
                    没有找到聊天记录
                  </p>
                )}
              {searchState.error && (
                <p className="sidebar-empty" role="alert">
                  {searchState.error}
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={
                      searchState.before
                        ? () => void searchState.more()
                        : searchState.retry
                    }
                  >
                    重试
                  </Button>
                </p>
              )}
              {searchState.before && !searchState.error && (
                <Button
                  variant="ghost"
                  size="small"
                  pending={searchState.loading}
                  onClick={() => void searchState.more()}
                >
                  更多聊天记录
                </Button>
              )}
            </>
          )}
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
      {attention?.error && (
        <p className="sidebar-empty" role="alert">
          {attention.error}
          <Button variant="ghost" size="small" onClick={attention.refresh}>
            重试
          </Button>
        </p>
      )}
    </aside>
  );
}
