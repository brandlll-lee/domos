import type { InputMaterials } from "@domos/agent/materials";
import { QuotesIcon } from "@phosphor-icons/react/dist/csr/Quotes";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";

export function materialTokens(materials?: InputMaterials) {
  return [
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
