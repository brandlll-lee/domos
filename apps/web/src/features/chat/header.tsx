import type { Bot } from "@domos/agent/bots";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import type { ReactNode } from "react";

export function ChatHeader({
  bot,
  busy,
  detailsOpen,
  computerOpen,
  modelSelector,
  context,
  onDetails,
  onComputer,
}: {
  bot: Bot;
  busy: boolean;
  detailsOpen: boolean;
  computerOpen: boolean;
  modelSelector: ReactNode;
  context?: ReactNode;
  onDetails: () => void;
  onComputer: () => void;
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
        <BotAvatar
          seed={bot.avatar}
          size="medium"
          state={busy ? "running" : "idle"}
          statusLabel="正在工作"
        />
        <span className="chat-identity-name">{bot.name}</span>
      </Button>
      <div className="chat-actions">
        {context}
        {modelSelector}
        <Button
          id="computer-trigger"
          variant="ghost"
          size="icon-small"
          className="chat-action"
          aria-label="Bot电脑"
          aria-expanded={computerOpen}
          title="工作电脑"
          onClick={onComputer}
        >
          <DesktopIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-small"
          className="chat-action"
          aria-label="Bot设置"
          title="Bot设置"
          onClick={onDetails}
        >
          <GearSixIcon />
        </Button>
      </div>
    </header>
  );
}
