import {
  type ReactNode,
  type Ref,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

export function MessageComposer({
  ref,
  value,
  onValueChange,
  onSubmit,
  label,
  placeholder,
  action,
  leading,
  attachments,
}: {
  ref?: Ref<HTMLTextAreaElement>;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder: string;
  action: ReactNode;
  leading?: ReactNode;
  attachments?: ReactNode;
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle<HTMLTextAreaElement | null, HTMLTextAreaElement | null>(
    ref,
    () => input.current,
    [],
  );
  useLayoutEffect(() => {
    const field = input.current;
    if (!field || CSS.supports("field-sizing", "content")) return;
    const resize = () => {
      field.style.height = "auto";
      field.style.height = value ? `${field.scrollHeight}px` : "";
    };
    resize();
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth !== width) {
        width = field.clientWidth;
        resize();
      }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [value]);
  return (
    <form
      className="message-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {attachments && <div className="composer-attachments">{attachments}</div>}
      <div className="composer-field">
        {leading && <div className="composer-leading">{leading}</div>}
        <label className="sr-only" htmlFor={id}>
          {label}
        </label>
        <textarea
          ref={input}
          id={id}
          name="message"
          rows={1}
          dir="auto"
          autoComplete="off"
          enterKeyHint="enter"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="composer-action">{action}</div>
      </div>
    </form>
  );
}
