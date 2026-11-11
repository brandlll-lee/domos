import type { Bot } from "@domos/agent/bots";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { EngineMark } from "../bots/engine-mark.tsx";
import { TeamAvatar } from "./bot-reference.tsx";

export function ChatHeader({
  bot,
  members,
  busy,
  detailsOpen,
  provider,
  onDetails,
}: {
  bot: Bot;
  members?: Bot[];
  busy: boolean;
  detailsOpen: boolean;
  provider?: string;
  onDetails: () => void;
}) {
  return (
    <header className="chat-header">
      <Button
        id="details-trigger"
        variant="ghost"
        size="small"
        className="chat-identity"
        aria-label={members ? "团队详情" : "Bot详情"}
        aria-expanded={detailsOpen}
        aria-controls={detailsOpen ? "bot-details" : undefined}
        onClick={onDetails}
      >
        <span className="chat-identity-icons" aria-hidden="true">
          {members ? (
            <TeamAvatar members={members} />
          ) : (
            <BotAvatar
              seed={bot.avatar}
              size="small"
              state={busy ? "running" : "idle"}
            />
          )}
          {!members && provider && <EngineMark provider={provider} />}
        </span>
        <span className="chat-identity-name">{bot.name}</span>
      </Button>
    </header>
  );
}
