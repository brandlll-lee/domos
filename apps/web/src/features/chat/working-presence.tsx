import type { Bot } from "@domos/agent/bots";
import { BotAvatar } from "@domos/ui/avatar";
import type { CharacterWork } from "@domos/ui/character-work";
import "./working-presence.css";

export function WorkingPresence({
  bot,
  activity,
  showName = false,
}: {
  bot: Bot;
  activity: CharacterWork & { id: string; label: string };
  showName?: boolean;
}) {
  const label = showName ? `${bot.name} · ${activity.label}` : activity.label;
  return (
    <section
      className="working-presence"
      data-working={activity.working || undefined}
      data-execution-id={activity.id}
      data-bot-id={bot.id}
      aria-label={`${bot.name}：${activity.label}`}
    >
      <span className="working-presence-avatar" aria-hidden="true">
        <BotAvatar
          botId={bot.id}
          seed={bot.avatar}
          media={bot.avatarMedia}
          size="small"
          work={{ id: activity.id, working: activity.working }}
        />
      </span>
      <span className="working-presence-label" title={label}>
        <span className="working-presence-phrase" key={label}>
          <span className="working-presence-text">{label}</span>
        </span>
      </span>
    </section>
  );
}
