import { ChatCircleIcon as ChatCircle } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { DesktopIcon as Desktop } from "@phosphor-icons/react/dist/csr/Desktop";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { useState } from "react";
import { chatCopy } from "./copy.ts";

export function Sidebar({
  preview,
  connection,
}: {
  preview: string;
  connection: string;
}) {
  const [query, setQuery] = useState("");
  const matches = `${chatCopy.conversation}\n${preview}`
    .toLocaleLowerCase()
    .includes(query.toLocaleLowerCase());
  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <a className="wordmark" href="/">
          domos.
        </a>
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
        {matches ? (
          <a className="active-chat" href="#conversation" aria-current="page">
            <ChatCircle size={22} aria-hidden="true" />
            <div className="chat-preview">
              <strong>{chatCopy.conversation}</strong>
              <span>{preview}</span>
            </div>
          </a>
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
