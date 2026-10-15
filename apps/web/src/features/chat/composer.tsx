import { MessageComposer } from "@domos/ui/composer";
import { Button } from "@domos/ui/controls";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { chatCopy } from "./copy.ts";
import { type SendMessage, useComposer } from "./use-composer.ts";

export function Composer({
  conversationId,
  connected,
  busy,
  sending,
  stopping,
  error,
  onSend,
  onStop,
}: {
  conversationId: number;
  connected: boolean;
  busy: boolean;
  sending: boolean;
  stopping: boolean;
  error: string | null;
  onSend: SendMessage;
  onStop: () => Promise<void>;
}) {
  const composer = useComposer(
    conversationId,
    connected && !busy && !sending,
    onSend,
  );
  const issue = error ?? composer.error;
  const action = busy
    ? {
        label: stopping ? chatCopy.stopping : chatCopy.stop,
        disabled: stopping || !connected,
      }
    : {
        label: sending
          ? chatCopy.sending
          : composer.pending
            ? chatCopy.retry
            : chatCopy.send,
        disabled:
          (!composer.value.trim() && !composer.pending) ||
          !connected ||
          sending,
      };
  return (
    <footer className="composer-area">
      {issue && (
        <p className="alert" role="alert">
          {issue}
        </p>
      )}
      <MessageComposer
        value={composer.value}
        onValueChange={composer.change}
        onSubmit={() => void composer.submit()}
        label={chatCopy.message}
        placeholder={chatCopy.placeholder}
        action={
          <Button
            type={busy ? "button" : "submit"}
            size="icon"
            title={action.label}
            aria-label={action.label}
            disabled={action.disabled}
            onClick={busy ? () => void onStop() : undefined}
          >
            {busy ? <StopIcon weight="fill" /> : <ArrowUpIcon />}
          </Button>
        }
      />
    </footer>
  );
}
