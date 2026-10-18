import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import "./profile.css";

export function AvatarEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="avatar-editor">
      <BotAvatar seed={value} size="large" />
      <Button
        type="button"
        variant="secondary"
        size="icon-small"
        aria-label="换个形象"
        title="换个形象"
        onClick={() => onChange(crypto.randomUUID())}
      >
        <ArrowsClockwiseIcon size={16} />
      </Button>
    </div>
  );
}
