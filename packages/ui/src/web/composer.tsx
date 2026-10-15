import { type ReactNode, useId, useLayoutEffect, useRef } from "react";

export function MessageComposer({
  value,
  onValueChange,
  onSubmit,
  label,
  placeholder,
  action,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder: string;
  action: ReactNode;
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
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
    </form>
  );
}
