import { Button } from "@domos/ui/controls";
import { SearchField } from "@domos/ui/field";
import { InlineNotice } from "@domos/ui/message";
import { ScrollArea } from "@domos/ui/scroll-area";
import { Tabs } from "@domos/ui/tabs";
import { compactChat } from "@domos/ui/tokens";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  type SettingsAccess,
  type SettingsSection,
  sections,
} from "./sections.tsx";

export function SettingsPage({
  initialSection: section,
  onSectionChange: setSection,
  botId,
  contentRef,
  message,
  onBack,
  ...access
}: SettingsAccess & {
  initialSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  botId?: number;
  contentRef: RefObject<HTMLDivElement | null>;
  message: string;
  onBack: () => void;
}) {
  const [visited, setVisited] = useState([section]);
  const [query, setQuery] = useState("");
  const [compact, setCompact] = useState(
    () => matchMedia(`(max-width: ${compactChat.maxWidth})`).matches,
  );
  const scroll = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLocaleLowerCase();
  const matches = (Object.keys(sections) as SettingsSection[]).filter((id) => {
    const item = sections[id];
    if (!item.primary && (section !== id || !access.admin)) return false;
    return `${item.label} ${item.description}`
      .toLocaleLowerCase()
      .includes(needle);
  });

  useEffect(() => {
    setVisited((current) =>
      current.includes(section) ? current : [...current, section],
    );
  }, [section]);

  useEffect(() => {
    const media = matchMedia(`(max-width: ${compactChat.maxWidth})`);
    const sync = () => setCompact(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  function select(next: SettingsSection) {
    setSection(next);
    setVisited((current) =>
      current.includes(next) ? current : [...current, next],
    );
    setQuery("");
    scroll.current?.scrollTo({ top: 0 });
  }

  return (
    <Tabs.Root
      className="settings-page"
      render={<main aria-label="设置" />}
      ref={contentRef}
      data-compact={compact || undefined}
      data-section={section}
      value={section}
      orientation={compact ? "horizontal" : "vertical"}
      onValueChange={(value) => select(value as SettingsSection)}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          !event.currentTarget.contains(event.target as Node)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        if (query) setQuery("");
        else onBack();
      }}
    >
      <aside className="settings-sidebar">
        <div className="settings-sidebar-heading">
          <Button
            id="settings-back"
            variant="ghost"
            size="icon-small"
            aria-label="返回对话"
            title="返回对话 · Esc"
            onClick={onBack}
          >
            <ArrowLeftIcon />
          </Button>
          <h1>设置</h1>
        </div>
        <SearchField
          className="settings-search"
          aria-label="搜索设置"
          placeholder="搜索设置"
          spellCheck={false}
          value={query}
          onValueChange={setQuery}
          onKeyDown={(event) => {
            const first = matches[0];
            if (event.key !== "Enter" || !first) return;
            event.preventDefault();
            select(first);
            requestAnimationFrame(() =>
              document.getElementById(`settings-${first}`)?.focus(),
            );
          }}
        />
        <span className="settings-nav-heading">工作区</span>
        <Tabs.List className="settings-nav" aria-label="设置分区">
          {matches.map((id) => {
            const item = sections[id];
            return (
              <Tabs.Tab
                className="navigation-tab"
                key={id}
                id={`settings-${id}`}
                value={id}
                aria-current={section === id ? "page" : undefined}
              >
                <item.icon aria-hidden="true" />
                <span>{item.label}</span>
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
        {!matches.length && (
          <p className="settings-empty" role="status">
            没有匹配的设置
          </p>
        )}
      </aside>
      <section
        className="settings-main"
        aria-label={sections[section].label}
        tabIndex={-1}
      >
        <header className="settings-header">
          <div>
            <h2>{sections[section].label}</h2>
            <p>{sections[section].description}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-small"
            aria-label="关闭设置"
            onClick={onBack}
          >
            <XIcon />
          </Button>
        </header>
        <ScrollArea className="settings-scroll" viewportRef={scroll}>
          <div className="settings-content">
            {visited.map((id) => (
              <Tabs.Panel key={id} value={id} keepMounted>
                {sections[id].render({ ...access, botId })}
              </Tabs.Panel>
            ))}
            {message && (
              <div role="status">
                <InlineNotice>{message}</InlineNotice>
              </div>
            )}
          </div>
        </ScrollArea>
      </section>
    </Tabs.Root>
  );
}
