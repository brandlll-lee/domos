import type { Bot, BotPresence } from "@domos/agent/bots";
import { BotAvatar } from "@domos/ui/avatar";
import { ScrollArea } from "@domos/ui/scroll-area";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { useEffect, useState } from "react";
import { chatCopy } from "./copy.ts";
import { contactTime } from "./format.ts";

const contactPreview = (bot: BotPresence) =>
  bot.busy ? chatCopy.working : bot.preview || "开始对话";

export function Sidebar({
  bots,
  selected,
  connected,
}: {
  bots: BotPresence[];
  selected: Bot;
  connected: boolean;
}) {
  const [query, setQuery] = useState("");
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
    <aside className="sidebar">
      <label className="sidebar-search">
        <MagnifyingGlass size={14} aria-hidden="true" />
        <input
          type="search"
          aria-label={chatCopy.search}
          placeholder="搜索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <ScrollArea className="sidebar-scroll">
        <nav aria-label={chatCopy.conversations}>
          {matches.length ? (
            matches.map((bot) => (
              <a
                className="contact-row"
                key={bot.id}
                href={`#bot/${bot.id}`}
                aria-label={bot.name}
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
              </a>
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
