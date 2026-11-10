import type { Bot, BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import { BOT_NAME_LENGTH, WORK_TEXT_LENGTH } from "@domos/agent/work/limits";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Dialog, PanelDialog } from "@domos/ui/dialog";
import { Checkbox, SearchField, TextField } from "@domos/ui/field";
import { ScrollArea } from "@domos/ui/scroll-area";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { client } from "../../client.ts";
import { chatCopy } from "./copy.ts";
import { contactTime } from "./format.ts";
import { prefetchChat } from "./use-chat.ts";

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
  actions,
  onSelect,
  compact,
  onExpand,
}: {
  bots: BotPresence[];
  teams: Team[];
  onTeamsChange: (teams: Team[]) => void;
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
        <SearchField
          className="sidebar-search"
          hidden={compact}
          inputRef={search}
          aria-label={chatCopy.search}
          placeholder="搜索"
          value={query}
          onValueChange={setQuery}
        />
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
                <span className="team-contact-icon">
                  <UsersThreeIcon />
                </span>
                <div className="chat-preview">
                  <strong>{team.name}</strong>
                  <span>{team.purpose || `${team.members.length} 位 Bot`}</span>
                </div>
              </PanelDialog.Close>
            ))}
        </nav>
      </ScrollArea>
      <CreateTeam
        bots={bots}
        onCreated={(team) => {
          onTeamsChange([...teams, team]);
          selectTeam(team);
        }}
      />
      {!connected && (
        <p className="sidebar-empty" role="status">
          正在连接…
        </p>
      )}
    </aside>
  );
}

function CreateTeam({
  bots,
  onCreated,
}: {
  bots: BotPresence[];
  onCreated: (team: Team) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [members, setMembers] = useState<number[]>([]);
  const [owner, setOwner] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const requestId = useRef(crypto.randomUUID());
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="新建 Bot 团队"
      trigger={
        <Button variant="ghost" size="small">
          <UsersThreeIcon /> 新建团队
        </Button>
      }
      footer={
        <>
          <Button
            variant="secondary"
            disabled={saving}
            onClick={() => setOpen(false)}
          >
            取消
          </Button>
          <Button
            pending={saving}
            disabled={!name.trim() || !members.length || owner === undefined}
            onClick={async () => {
              if (owner === undefined) return;
              setSaving(true);
              setError(undefined);
              try {
                const team = await client.teams.create({
                  id: requestId.current,
                  name,
                  purpose,
                  members,
                  owner,
                });
                onCreated(team);
                requestId.current = crypto.randomUUID();
                setOpen(false);
                setName("");
                setPurpose("");
                setMembers([]);
                setOwner(undefined);
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "团队创建失败。",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            创建
          </Button>
        </>
      }
    >
      <TextField
        label="团队名称"
        value={name}
        onValueChange={setName}
        maxLength={BOT_NAME_LENGTH}
      />
      <TextField
        label="团队用途"
        value={purpose}
        onValueChange={setPurpose}
        multiline
        maxLength={WORK_TEXT_LENGTH}
      />
      <fieldset className="team-member-list">
        <legend>成员</legend>
        {bots.map((bot) => (
          <Checkbox
            key={bot.id}
            label={bot.name}
            checked={members.includes(bot.id)}
            onCheckedChange={(checked) => {
              setMembers((current) =>
                checked
                  ? [...current, bot.id]
                  : current.filter((id) => id !== bot.id),
              );
              if (checked) setOwner((current) => current ?? bot.id);
              else if (owner === bot.id)
                setOwner(members.find((id) => id !== bot.id));
            }}
          />
        ))}
      </fieldset>
      {members.length > 0 && (
        <label className="team-owner-label">
          默认负责人
          <select
            value={owner}
            onChange={(event) => setOwner(Number(event.target.value))}
          >
            {members.map((id) => (
              <option key={id} value={id}>
                {bots.find((bot) => bot.id === id)?.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
