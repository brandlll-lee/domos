import { MessageBubble } from "@domos/ui/message";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";

export function ErrorMessage({ children }: { children: string }) {
  return (
    <article className="message assistant message-error">
      <MessageBubble side="incoming">
        <div className="message-error-content" role="alert">
          <WarningIcon aria-hidden="true" />
          <p>{children}</p>
        </div>
      </MessageBubble>
    </article>
  );
}
