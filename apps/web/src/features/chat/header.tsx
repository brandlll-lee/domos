import type { Bot } from "@domos/agent/bots";
import { Button } from "@domos/ui/controls";
import { EngineMark } from "../bots/engine-mark.tsx";
import type { WorkActivity } from "./activity-state.ts";
import { TeamAvatar } from "./bot-reference.tsx";
import { IdentityAvatar } from "./identity-avatar.tsx";

export function ChatHeader({
  bot,
  conversationTitle,
  members,
  busy,
  activity,
  stopping,
  detailsOpen,
  provider,
  onDetails,
}: {
  bot: Bot;
  conversationTitle?: string;
  members?: Bot[];
  busy: boolean;
  activity: WorkActivity[];
  stopping: boolean;
  detailsOpen: boolean;
  provider?: string;
  onDetails: () => void;
}) {
  const active = busy ? activity : [];
  const current =
    active.find((item) => item.attention) ??
    active.find((item) => item.working) ??
    active[0];
  const working = !stopping && Boolean(current?.working);
  const actors = new Set(
    active
      .filter((item) => item.working === current?.working)
      .map((item) => item.botId ?? item.author?.botId)
      .filter((id) => id !== undefined),
  );
  const name =
    current?.author?.name ??
    members?.find((member) => member.id === current?.botId)?.name;
  const label = stopping
    ? "正在停止"
    : members && actors.size > 1
      ? `${actors.size} 位成员${current?.working ? "正在工作" : "等待处理"}`
      : `${members && name ? `${name} ` : ""}${current?.label ?? "正在工作"}`;
  return (
    <header className="chat-header">
      <div className="chat-header-fade" aria-hidden="true" />
      <Button
        id="details-trigger"
        variant="ghost"
        size="small"
        className="chat-identity"
        data-active={busy || undefined}
        aria-label={members ? "团队详情" : "Bot详情"}
        aria-expanded={detailsOpen}
        aria-controls={detailsOpen ? "bot-details" : undefined}
        onClick={onDetails}
      >
        <span className="chat-identity-avatar" aria-hidden="true">
          {members ? (
            <TeamAvatar
              members={members}
              activity={active}
              stopping={stopping}
            />
          ) : (
            <IdentityAvatar
              bot={bot}
              busy={busy}
              work={{ id: current?.id, working }}
            />
          )}
        </span>
        <span className="chat-identity-label">
          <span className="chat-identity-title">
            {!members && provider && <EngineMark provider={provider} />}
            <span className="chat-identity-name" title={bot.name}>
              {bot.name}
            </span>
            {conversationTitle && (
              <>
                <span className="chat-identity-separator" aria-hidden="true">
                  ›
                </span>
                <span
                  className="chat-identity-conversation"
                  title={conversationTitle}
                >
                  {conversationTitle}
                </span>
              </>
            )}
          </span>
          <span
            className="chat-identity-status"
            aria-live="polite"
            aria-atomic="true"
            title={busy ? label : undefined}
          >
            {busy ? label : ""}
          </span>
        </span>
      </Button>
    </header>
  );
}
