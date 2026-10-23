import { BotAvatar } from "@domos/ui/avatar";
import {
  characterColors,
  characterIdentity,
  characterNames,
  characterSeed,
} from "@domos/ui/characters";
import { Button } from "@domos/ui/controls";
import { Popover } from "@domos/ui/popover";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import "./profile.css";

export function AvatarEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const identity = characterIdentity(value);
  return (
    <div className="avatar-editor">
      <BotAvatar seed={value} size="large" />
      <Popover.Root>
        <Popover.Trigger
          render={
            <Button
              type="button"
              variant="secondary"
              size="icon-small"
              aria-label="选择头像"
              title="选择头像"
            />
          }
        >
          <PencilSimpleIcon size={16} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className="picker-positioner"
            sideOffset={8}
            collisionPadding={12}
            align="start"
          >
            <Popover.Popup className="picker-popup avatar-picker">
              <Popover.Title className="sr-only">头像外观</Popover.Title>
              <fieldset className="avatar-shapes" aria-label="外形">
                {(
                  Object.keys(characterNames) as (keyof typeof characterNames)[]
                ).map((shape) => (
                  <Button
                    key={shape}
                    variant="ghost"
                    aria-label={`外形：${characterNames[shape]}`}
                    title={characterNames[shape]}
                    aria-pressed={identity.shape === shape}
                    onClick={() =>
                      onChange(characterSeed(shape, identity.color))
                    }
                  >
                    <BotAvatar
                      seed={characterSeed(shape, identity.color)}
                      size="medium"
                    />
                  </Button>
                ))}
              </fieldset>
              <fieldset className="avatar-colors" aria-label="颜色">
                {characterColors.map(({ name, color }) => (
                  <Button
                    key={color}
                    variant="ghost"
                    aria-label={`颜色：${name}`}
                    title={name}
                    aria-pressed={identity.color === color}
                    onClick={() =>
                      onChange(characterSeed(identity.shape, color))
                    }
                  >
                    <span style={{ backgroundColor: color }} />
                  </Button>
                ))}
              </fieldset>
              <Button
                type="button"
                variant="ghost"
                size="small"
                aria-label="换个形象"
                onClick={() => onChange(characterSeed())}
              >
                <ArrowsClockwiseIcon size={16} />
              </Button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
