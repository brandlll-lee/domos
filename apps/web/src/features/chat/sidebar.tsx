import type { Bot, BotPresence } from "@domos/agent/bots";
import { BotAvatar } from "@domos/ui/avatar";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { useState } from "react";
import { chatCopy } from "./copy.ts";

export function Sidebar({
  bots,
  selected,
  preview,
  connected,
}: {
  bots: BotPresence[];
  selected: Bot;
  preview: string;
  connected: boolean;
}) {
  const [query, setQuery] = useState("");
  const matches = bots.filter((bot) =>
    `${bot.name}\n${bot.id === selected.id ? preview : ""}`
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
                {bot.id === selected.id && <span>{preview}</span>}
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
