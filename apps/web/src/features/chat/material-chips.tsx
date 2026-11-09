import type { InputMaterials } from "@domos/agent/materials";
import { QuotesIcon } from "@phosphor-icons/react/dist/csr/Quotes";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";

export function MaterialChips({ materials }: { materials?: InputMaterials }) {
  const skills =
    materials?.skills.filter((skill) => skill.position === undefined) ?? [];
  const context =
    materials?.context.filter((item) => item.position === undefined) ?? [];
  if (!skills.length && !context.length) return null;
  return (
    <div className="material-chips">
      {skills.map((skill) => (
        <span
          className="material-chip"
          key={skill.id}
          title={`${skill.name} · v${skill.revision}`}
        >
          <SparkleIcon />
          <span>{skill.name}</span>
        </span>
      ))}
      {context.map((context) => (
        <span className="material-chip" key={context.id} title={context.text}>
          <QuotesIcon />
          <span>{context.text}</span>
        </span>
      ))}
    </div>
  );
}
