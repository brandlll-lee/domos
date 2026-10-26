import type { Bot } from "@domos/agent/bots";
import type { EngineId } from "@domos/agent/harness/types";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { EngineMark } from "../bots/engine-mark.tsx";

export function ChatHeader({
  bot,
  busy,
  detailsOpen,
  provider,
  onDetails,
}: {
  bot: Bot;
  busy: boolean;
  detailsOpen: boolean;
  provider: EngineId;
  onDetails: () => void;
}) {
  return (
    <header className="chat-header">
      <Button
        id="details-trigger"
        variant="ghost"
        size="small"
        className="chat-identity"
        aria-label="Bot详情"
        aria-expanded={detailsOpen}
        aria-controls={detailsOpen ? "bot-details" : undefined}
        onClick={onDetails}
      >
        <span className="chat-identity-icons" aria-hidden="true">
          <BotAvatar
            seed={bot.avatar}
            size="small"
            state={busy ? "running" : "idle"}
          />
          <EngineMark provider={provider} />
        </span>
        <span className="chat-identity-name">{bot.name}</span>
      </Button>
    </header>
  );
}
