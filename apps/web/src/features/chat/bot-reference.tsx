import { BotAvatar } from "@domos/ui/avatar";
import { characterIdentity } from "@domos/ui/characters";
import type { CSSProperties } from "react";
import { createContext } from "react";
export const TeamMembers = createContext<
  { id: number; name: string; avatar: string }[]
>([]);
export function BotReference({
  bot,
}: {
  bot: { botId: number; name: string; avatar: string };
}) {
  return (
    <span
      className="bot-reference"
      data-bot-id={bot.botId}
      style={
        { "--bot-color": characterIdentity(bot.avatar).color } as CSSProperties
      }
    >
      <BotAvatar seed={bot.avatar} size="small" />
      <span>{bot.name}</span>
    </span>
  );
}
export function TeamAvatar({
  members,
}: {
  members: { id: number; name: string; avatar: string }[];
}) {
  return (
    <span
      className="team-avatar"
      role="img"
      aria-label={members.map((bot) => bot.name).join("、")}
      style={
        {
          "--team-columns": Math.ceil(Math.sqrt(members.length)),
        } as CSSProperties
      }
    >
      {members.map((bot) => (
        <span key={bot.id} title={bot.name}>
          <BotAvatar seed={bot.avatar} size="small" />
        </span>
      ))}
    </span>
  );
}
