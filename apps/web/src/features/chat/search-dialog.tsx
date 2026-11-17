import type { BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { SearchField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { Tabs } from "@domos/ui/tabs";
import { type KeyboardEvent, type RefObject, useRef, useState } from "react";
import { selectBot } from "../bots/use-bots.ts";
import { openChatTarget } from "./attention.tsx";
import { TeamAvatar } from "./bot-reference.tsx";
import { chatCopy } from "./copy.ts";
import { contactTime } from "./format.ts";
import { contactPreview, selectTeam } from "./sidebar.tsx";
import type { useHistorySearch } from "./use-history-search.ts";

export function SearchDialog({
  open,
  onOpenChange,
  trigger,
  bots,
  teams,
  search,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: RefObject<HTMLButtonElement | null>;
  bots: BotPresence[];
  teams: Team[];
  search: ReturnType<typeof useHistorySearch>;
  onNavigate: () => void;
}) {
  const [tab, setTab] = useState("all");
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const query = search.query.trim().toLocaleLowerCase();
  const contacts = tab !== "messages";
  const messages = tab !== "contacts" && Boolean(query);
  const matches = bots.filter((bot) =>
    `${bot.name}\n${contactPreview(bot)}`.toLocaleLowerCase().includes(query),
  );
  const matchingTeams = teams.filter((team) =>
    `${team.name} ${team.purpose}`.toLocaleLowerCase().includes(query),
  );
  function navigate(action: () => void) {
    onOpenChange(false);
    onNavigate();
    action();
  }
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    const items = Array.from(
      results.current?.querySelectorAll<HTMLButtonElement>(".search-hit") ?? [],
    );
    if (event.key === "Enter" && event.target === input.current) {
      event.preventDefault();
      items[0]?.click();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const index = items.indexOf(event.target as HTMLButtonElement);
      event.preventDefault();
      const next =
        event.key === "ArrowDown"
          ? items[Math.min(index + 1, items.length - 1)]
          : index < 0
            ? items.at(-1)
            : (items[index - 1] ?? input.current);
      next?.focus();
    }
  }
  return (
    <Dialog
      title="搜索"
      className="chat-search-dialog"
      open={open}
      onOpenChange={onOpenChange}
      initialFocus={() => input.current}
      finalFocus={() => trigger.current}
      subheader={
        <div className="chat-search-controls">
          <SearchField
            inputRef={input}
            aria-label={chatCopy.search}
            placeholder="搜索 Bot、团队和聊天记录"
            value={search.query}
            onValueChange={search.setQuery}
            onKeyDown={keyDown}
          />
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List className="workspace-tabs" aria-label="搜索范围">
              <Tabs.Tab className="navigation-tab" value="all">
                全部
              </Tabs.Tab>
              <Tabs.Tab className="navigation-tab" value="contacts">
                Bot与团队
              </Tabs.Tab>
              <Tabs.Tab className="navigation-tab" value="messages">
                聊天记录
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.Root>
        </div>
      }
      footer={
        <span className="chat-search-hint">↑ ↓ 选择　Enter 打开　Esc 关闭</span>
      }
    >
      <div className="chat-search-results" ref={results}>
        {contacts && (
          <section aria-label="Bot与团队">
            <h3 className="search-section">Bot与团队</h3>
            {matches.map((bot) => (
              <Button
                key={bot.id}
                variant="ghost"
                className="contact-row search-hit"
                onKeyDown={keyDown}
                aria-label={bot.name}
                onClick={() => navigate(() => selectBot(bot))}
              >
                <BotAvatar botId={bot.id} seed={bot.avatar} />
                <div className="chat-preview">
                  <strong>{bot.name}</strong>
                  <span>{contactPreview(bot)}</span>
                </div>
              </Button>
            ))}
            {matchingTeams.map((team) => (
              <Button
                key={team.id}
                variant="ghost"
                className="contact-row search-hit"
                onKeyDown={keyDown}
                aria-label={team.name}
                onClick={() => navigate(() => selectTeam(team))}
              >
                <TeamAvatar
                  members={bots.filter((bot) => team.members.includes(bot.id))}
                />
                <div className="chat-preview">
                  <strong>{team.name}</strong>
                  <span>{team.purpose || `${team.members.length} 位 Bot`}</span>
                </div>
              </Button>
            ))}
            {!matches.length && !matchingTeams.length && (
              <p className="sidebar-empty" role="status">
                没有找到联系人
              </p>
            )}
          </section>
        )}
        {messages && (
          <section aria-label="聊天记录">
            <h3 className="search-section">聊天记录</h3>
            {search.items.map((item) => (
              <Button
                key={item.sequence}
                variant="ghost"
                className="contact-row search-hit search-result"
                onKeyDown={keyDown}
                aria-label={`${item.name}：${item.snippet}`}
                onClick={() => navigate(() => openChatTarget(item))}
              >
                <BotAvatar
                  media={item.avatarMedia}
                  botId={item.botId}
                  seed={item.avatar}
                />
                <div className="chat-preview">
                  <strong>{item.name}</strong>
                  {!!item.timestamp && (
                    <time dateTime={new Date(item.timestamp).toISOString()}>
                      {contactTime(item.timestamp, Date.now())}
                    </time>
                  )}
                  <span className="search-author">{item.author}</span>
                  <span className="search-snippet">{item.snippet}</span>
                </div>
              </Button>
            ))}
            {search.loading && <Loading label="正在搜索聊天记录" />}
            {!search.loading && !search.error && !search.items.length && (
              <p className="sidebar-empty" role="status">
                没有找到聊天记录
              </p>
            )}
            {search.error && (
              <InlineNotice>
                {search.error}
                <Button
                  variant="ghost"
                  size="small"
                  onClick={
                    search.before ? () => void search.more() : search.retry
                  }
                >
                  重试
                </Button>
              </InlineNotice>
            )}
            {search.before && !search.error && (
              <Button
                variant="ghost"
                size="small"
                pending={search.loading}
                onClick={() => void search.more()}
              >
                更多聊天记录
              </Button>
            )}
          </section>
        )}
        {tab === "messages" && !query && (
          <p className="sidebar-empty" role="status">
            输入关键词搜索聊天记录
          </p>
        )}
      </div>
    </Dialog>
  );
}
