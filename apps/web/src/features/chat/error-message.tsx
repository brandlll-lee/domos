import { Button } from "@domos/ui/controls";
import { MessageBubble } from "@domos/ui/message";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";

export function ErrorMessage({
  children,
  onInspect,
}: {
  children: string;
  onInspect?: () => void;
}) {
  return (
    <article className="message assistant message-error">
      <MessageBubble side="incoming">
        <div className="message-error-content" role="alert">
          <WarningIcon aria-hidden="true" />
          <p>{children}</p>
        </div>
        {onInspect && (
          <Button variant="ghost" size="small" onClick={onInspect}>
            查看工作记录
          </Button>
        )}
      </MessageBubble>
    </article>
  );
}
