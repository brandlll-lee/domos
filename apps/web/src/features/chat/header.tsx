import type { Bot } from "@domos/agent/bots";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";

export function ChatHeader({
  bot,
  detailsOpen,
  onProfile,
  onComputer,
}: {
  bot: Bot;
  detailsOpen: boolean;
  onProfile: () => void;
  onComputer: () => void;
}) {
  return (
    <header className="chat-header">
      <Button
        id="details-trigger"
        variant="ghost"
        size="small"
        className="conversation-title"
        aria-label="Bot详情"
        aria-expanded={detailsOpen}
        aria-controls={detailsOpen ? "bot-details" : undefined}
        onClick={onProfile}
      >
        <BotAvatar seed={bot.avatar} size="small" />
        <span>{bot.name}</span>
      </Button>
      <div className="chat-actions">
        <Button
          variant="ghost"
          size="icon-small"
          aria-label="Bot电脑"
          title="工作电脑"
          onClick={onComputer}
        >
          <DesktopIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-small"
          aria-label="Bot设置"
          title="Bot设置"
          onClick={onProfile}
        >
          <GearSixIcon />
        </Button>
      </div>
    </header>
  );
}
