import type { Bot } from "@domos/agent/bots";
import type { ChatView } from "@domos/agent/view";
import { BotAvatar, BrandMark } from "@domos/ui/avatar";
import { DesktopIcon as Desktop } from "@phosphor-icons/react/dist/csr/Desktop";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { useState } from "react";
import { CreateBot } from "../bots/create-bot.tsx";
import { selectBot } from "../bots/use-bots.ts";
import { chatCopy } from "./copy.ts";

export function Sidebar({
  bots,
  selected,
  model,
  preview,
  connection,
  busy,
}: {
  bots: Bot[];
  selected: Bot;
  model: ChatView["model"];
  preview: string;
  connection: string;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const matches = bots.filter((bot) =>
    `${bot.name}\n${bot.id === selected.id ? preview : ""}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <a className="wordmark" href="/">
          <BrandMark />
          domos.
        </a>
        <CreateBot model={model} onCreated={selectBot} />
      </header>
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
      <div className="sidebar-label">{chatCopy.conversations}</div>
      <nav aria-label={chatCopy.conversations}>
        {matches.length ? (
          matches.map((bot) => (
            <a
              className="contact-row"
              key={bot.id}
              href={`#bot/${bot.id}`}
              aria-current={bot.id === selected.id ? "page" : undefined}
            >
              <BotAvatar
                seed={bot.avatar}
                state={bot.id === selected.id && busy ? "running" : "idle"}
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
      <footer className="sidebar-footer">
        <Desktop size={18} aria-hidden="true" />
        <div>
          <strong>{chatCopy.workspace}</strong>
          <span>{connection}</span>
        </div>
      </footer>
    </aside>
  );
}
