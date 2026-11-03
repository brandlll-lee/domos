import type { Bot, BotPresence } from "@domos/agent/bots";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { PanelDialog } from "@domos/ui/dialog";
import { ScrollArea } from "@domos/ui/scroll-area";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { chatCopy } from "./copy.ts";
import { contactTime } from "./format.ts";
import { prefetchChat } from "./use-chat.ts";

const contactPreview = (bot: BotPresence) =>
  bot.busy ? chatCopy.working : bot.preview || "开始对话";

export function Sidebar({
  bots,
  selected,
  connected,
  actions,
  onSelect,
  compact,
  onExpand,
}: {
  bots: BotPresence[];
  selected: Bot;
  connected: boolean;
  actions: ReactNode;
  onSelect: () => void;
  compact: boolean;
  onExpand: () => void;
}) {
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
        <label className="sidebar-search" hidden={compact}>
          <MagnifyingGlass size={14} aria-hidden="true" />
          <input
            ref={search}
            type="search"
            aria-label={chatCopy.search}
            placeholder="搜索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {actions}
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
                aria-current={bot.id === selected.id ? "page" : undefined}
              >
                <BotAvatar
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
        </nav>
      </ScrollArea>
      {!connected && (
        <p className="sidebar-empty" role="status">
          正在连接…
        </p>
      )}
    </aside>
  );
}
