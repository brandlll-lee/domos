import type { Bot } from "@domos/agent/bots";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { ModelSelector } from "@domos/ui/model-selector";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";

export function ChatHeader({
  bot,
  busy,
  detailsOpen,
  computerOpen,
  providers,
  models,
  selectedProvider,
  selectedModel,
  onDetails,
  onComputer,
  onProviderChange,
  onModelChange,
  onConfigClick,
}: {
  bot: Bot;
  busy: boolean;
  detailsOpen: boolean;
  computerOpen: boolean;
  providers?: Array<{ id: string; name: string }>;
  models?: Array<{ id: string; name: string; provider: string }>;
  selectedProvider?: string;
  selectedModel?: string;
  onDetails: () => void;
  onComputer: () => void;
  onProviderChange?: (id: string) => void;
  onModelChange?: (id: string) => void;
  onConfigClick?: () => void;
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
        {providers && models && selectedProvider && selectedModel && onProviderChange && onModelChange && onConfigClick && (
          <ModelSelector
            providers={providers.map((p) => ({ id: p.id, name: p.name }))}
            models={models.map((m) => ({ id: m.id, name: m.name, provider: m.provider }))}
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            onProviderChange={onProviderChange}
            onModelChange={onModelChange}
            onConfigClick={onConfigClick}
          />
        )}
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
