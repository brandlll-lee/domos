import type { InputMaterials } from "@domos/agent/materials";
import { PlugsIcon } from "@phosphor-icons/react/dist/csr/Plugs";
import { QuotesIcon } from "@phosphor-icons/react/dist/csr/Quotes";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import { BotReference } from "./bot-reference.tsx";

export function materialTokens(materials?: InputMaterials) {
  return [
    ...(materials?.bots?.map((bot) => ({
      id: `bot:${bot.id}`,
      position: bot.position,
      title: bot.name,
      content: <BotReference bot={bot} />,
    })) ?? []),
    ...(materials?.mcp?.map((item) => ({
      id: `mcp:${item.id}`,
      position: item.position,
      title: `${item.name} · ${item.native ? item.native.provider : "Domos"}`,
      content: (
        <>
          <PlugsIcon />
          <span>{item.name}</span>
        </>
      ),
    })) ?? []),
    ...(materials?.skills.map((skill) => ({
      id: `skill:${skill.id}`,
      position: skill.position,
      title: skill.name,
      content: (
        <>
          <SparkleIcon />
          <span>{skill.name}</span>
        </>
      ),
    })) ?? []),
    ...(materials?.context.map((context) => ({
      id: `context:${context.id}`,
      position: context.position,
      title: context.text,
      content: (
        <>
          <QuotesIcon />
          <span>{context.text.slice(0, 80)}</span>
        </>
      ),
    })) ?? []),
  ];
}
