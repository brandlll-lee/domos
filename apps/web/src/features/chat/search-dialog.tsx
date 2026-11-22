import type { BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { SearchField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { Tabs } from "@domos/ui/tabs";
import { ArrowElbowDownLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowElbowDownLeft";
import { type RefObject, useEffect, useRef, useState } from "react";
import { selectBot } from "../bots/use-bots.ts";
import { openChatTarget } from "./attention.tsx";
import { TeamAvatar } from "./bot-reference.tsx";
import { selectConversation } from "./conversations.tsx";
import { chatCopy } from "./copy.ts";
import { contactTime } from "./format.ts";
import { contactPreview, selectTeam } from "./sidebar.tsx";
import { useCommandSelection } from "./use-command-selection.ts";
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
  const viewport = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const query = search.query.trim().toLocaleLowerCase();
  const contacts = tab !== "messages";
  const messages = tab !== "contacts" && Boolean(query);
  const groups = [
    {
      name: "Bot 与团队",
      items: contacts
        ? [
            ...bots
              .filter((bot) =>
                `${bot.name}\n${contactPreview(bot)}`
                  .toLocaleLowerCase()
                  .includes(query),
              )
              .map((bot) => ({
                id: `bot-${bot.id}`,
                name: bot.name,
                preview: contactPreview(bot),
                timestamp: bot.lastMessageAt,
                avatar: <BotAvatar botId={bot.id} seed={bot.avatar} />,
                label: bot.name,
                onOpen: () => selectBot(bot),
              })),
            ...teams
              .filter((team) =>
                `${team.name} ${team.purpose}`
                  .toLocaleLowerCase()
                  .includes(query),
              )
              .map((team) => ({
                id: `team-${team.id}`,
                name: team.name,
                preview: team.purpose || `${team.members.length} 位 Bot`,
                timestamp: undefined,
                avatar: (
                  <TeamAvatar
                    members={bots.filter((bot) =>
                      team.members.includes(bot.id),
                    )}
                  />
                ),
                label: team.name,
                onOpen: () => selectTeam(team),
              })),
          ]
        : [],
    },
    {
      name: "最近会话",
      items:
        tab === "all" && !query
          ? bots
              .flatMap((bot) =>
                (bot.conversations ?? [])
                  .filter((item) => !item.archived)
                  .map((item) => ({
                    id: `conversation-${item.id}`,
                    name: item.title,
                    preview: bot.name,
                    timestamp: item.updatedAt,
                    avatar: <BotAvatar botId={bot.id} seed={bot.avatar} />,
                    label: `${bot.name}：${item.title}`,
                    onOpen: () => selectConversation(bot.id, item.id),
                  })),
              )
              .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
              .slice(0, 6)
          : [],
    },
    {
      name: "聊天记录",
      items: messages
        ? search.items.map((item) => ({
            id: `message-${item.sequence}`,
            name: item.name,
            preview: `${item.author}：${item.snippet}`,
            timestamp: item.timestamp,
            avatar: (
              <BotAvatar
                media={item.avatarMedia}
                botId={item.botId}
                seed={item.avatar}
              />
            ),
            label: `${item.name}：${item.snippet}`,
            onOpen: () => openChatTarget(item),
          }))
        : [],
    },
  ];
  const command = useCommandSelection(
    groups.flatMap((group) => group.items.map((item) => item.id)),
    `${open}:${query}:${tab}`,
  );

  useEffect(() => {
    if (
      !open ||
      !messages ||
      !search.before ||
      search.loading ||
      search.error ||
      !sentinel.current
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void search.more();
      },
      { root: viewport.current, rootMargin: "80px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [
    open,
    messages,
    search.before,
    search.loading,
    search.error,
    search.more,
  ]);

  return (
    <Dialog
      title={<span className="sr-only">搜索</span>}
      className="chat-command-dialog chat-search-dialog"
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={command.onOpenChangeComplete}
      initialFocus={() => command.input.current}
      finalFocus={() => trigger.current}
      viewportRef={viewport}
      subheader={
        <div className="command-controls">
          <SearchField
            className="command-search"
            inputRef={command.input}
            aria-label={chatCopy.search}
            placeholder="搜索 Bot、团队和聊天记录"
            value={search.query}
            onValueChange={search.setQuery}
            {...command.inputProps}
          />
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List className="command-tabs" aria-label="搜索范围">
              <Tabs.Tab className="navigation-tab" value="all">
                全部
              </Tabs.Tab>
              <Tabs.Tab className="navigation-tab" value="contacts">
                Bot 与团队
              </Tabs.Tab>
              <Tabs.Tab className="navigation-tab" value="messages">
                聊天记录
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.Root>
        </div>
      }
      footer={
        <span className="chat-search-hint">↑↓ 选择　Enter 打开　Esc 关闭</span>
      }
    >
      <table
        className="chat-search-results command-results"
        {...command.listProps}
        aria-label="搜索结果"
      >
        {groups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <tbody key={group.name} aria-label={group.name}>
              <tr>
                <td>
                  <h3 className="search-section">{group.name}</h3>
                </td>
              </tr>
              {group.items.map((item) => (
                <tr
                  className="command-row"
                  key={item.id}
                  {...command.rowProps(item.id)}
                >
                  <td className="command-main-cell">
                    <Button
                      variant="ghost"
                      className={`contact-row search-hit${group.name === "聊天记录" ? " search-result" : ""}`}
                      data-command-action
                      onKeyDown={command.keyDown}
                      aria-label={item.label}
                      onClick={() => {
                        onOpenChange(false);
                        onNavigate();
                        item.onOpen();
                      }}
                    >
                      {item.avatar}
                      <span className="chat-preview">
                        <strong>{item.name}</strong>
                        <span>{item.preview}</span>
                      </span>
                      {!!item.timestamp && (
                        <time dateTime={new Date(item.timestamp).toISOString()}>
                          {contactTime(item.timestamp, Date.now())}
                        </time>
                      )}
                      <ArrowElbowDownLeftIcon
                        className="command-enter"
                        aria-hidden="true"
                      />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
      </table>
      {contacts && !groups[0]?.items.length && (
        <p className="sidebar-empty" role="status">
          没有找到联系人
        </p>
      )}
      {messages && (
        <>
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
          <div ref={sentinel} className="command-load-sentinel" />
        </>
      )}
      {tab === "messages" && !query && (
        <p className="sidebar-empty" role="status">
          输入关键词搜索聊天记录
        </p>
      )}
    </Dialog>
  );
}
