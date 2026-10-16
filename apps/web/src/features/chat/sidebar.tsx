import type { Bot, BotPresence } from "@domos/agent/bots";
import { BotAvatar } from "@domos/ui/avatar";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { useState } from "react";
import { chatCopy } from "./copy.ts";

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
  const matches = bots.filter((bot) =>
    `${bot.name}\n${contactPreview(bot)}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <aside className="sidebar">
      <label className="sidebar-search">
        <MagnifyingGlass size={16} aria-hidden="true" />
        <input
          type="search"
          aria-label={chatCopy.search}
          placeholder={chatCopy.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
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
    </aside>
  );
}
