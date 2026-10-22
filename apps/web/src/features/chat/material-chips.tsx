import type { InputMaterials } from "@domos/agent/materials";
import { Button } from "@domos/ui/controls";
import { QuotesIcon } from "@phosphor-icons/react/dist/csr/Quotes";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

export function MaterialChips({
  materials,
  disabled,
  onChange,
}: {
  materials?: InputMaterials;
  disabled?: boolean;
  onChange?: (materials: InputMaterials) => void;
}) {
  if (!materials || (!materials.skills.length && !materials.context.length))
    return null;
  return (
    <div className="material-chips">
      {materials.skills.map((skill) => (
        <span
          className="material-chip"
          key={skill.id}
          title={`${skill.name} · v${skill.revision}`}
        >
          <SparkleIcon />
          <span>{skill.name}</span>
          {onChange && (
            <Button
              variant="ghost"
              size="icon-small"
              aria-label={`移除技能 ${skill.name}`}
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...materials,
                  skills: materials.skills.filter(
                    (item) => item.id !== skill.id,
                  ),
                })
              }
            >
              <XIcon />
            </Button>
          )}
        </span>
      ))}
      {materials.context.map((context) => (
        <span className="material-chip" key={context.id} title={context.text}>
          <QuotesIcon />
          <span>{context.text}</span>
          {onChange && (
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="移除引用"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...materials,
                  context: materials.context.filter(
                    (item) => item.id !== context.id,
                  ),
                })
              }
            >
              <XIcon />
            </Button>
          )}
        </span>
      ))}
    </div>
  );
}
