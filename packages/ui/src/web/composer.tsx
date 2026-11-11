import {
  type ClipboardEventHandler,
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type ComposerToken = {
  id: string;
  position: number;
  content: ReactNode;
  title?: string;
};

function readEditor(root: ParentNode) {
  let text = "";
  const positions: { id: string; position: number }[] = [];
  const read = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (node instanceof HTMLElement && node.dataset.inlineToken) {
      positions.push({
        id: node.dataset.inlineToken,
        position: text.length + positions.length,
      });
      return;
    }
    if (node instanceof HTMLBRElement) {
      if (node.nextSibling) text += "\n";
      return;
    }
    const block =
      node instanceof HTMLElement && ["DIV", "P"].includes(node.tagName);
    if (block && node.previousSibling) text += "\n";
    node.childNodes.forEach(read);
  };
  root.childNodes.forEach(read);
  return { text, positions };
}

function caretOffset(root: HTMLElement) {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  if (!selection?.rangeCount || !anchor || !root.contains(anchor)) return 0;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(root);
  range.setEnd(anchor, selection.anchorOffset);
  const parsed = readEditor(range.cloneContents());
  return parsed.text.length + parsed.positions.length;
}

function setCaret(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) =>
        node.parentElement?.closest("[data-inline-token]")
          ? NodeFilter.FILTER_REJECT
          : node.nodeType === Node.TEXT_NODE ||
              (node instanceof HTMLElement && node.dataset.inlineToken)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP,
    },
  );
  let remaining = offset;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const token = node instanceof HTMLElement && node.dataset.inlineToken;
    const length = token ? 1 : (node.textContent?.length ?? 0);
    if (remaining <= length) {
      const range = document.createRange();
      if (token) {
        if (remaining) range.setStartAfter(node);
        else range.setStartBefore(node);
      } else range.setStart(node, remaining);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    remaining -= length;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function MessageComposer({
  ref,
  value,
  onValueChange,
  onCaretChange,
  tokens = [],
  onSubmit,
  onPaste,
  onKeyDown,
  label,
  placeholder,
  action,
  leading,
  attachments,
}: {
  ref?: Ref<HTMLDivElement>;
  value: string;
  onValueChange: (
    value: string,
    caret: number,
    positions: { id: string; position: number }[],
  ) => void;
  onCaretChange: (position: number) => void;
  tokens?: ComposerToken[];
  onSubmit: () => void;
  onPaste?: ClipboardEventHandler<HTMLDivElement>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  label: string;
  placeholder: string;
  action: ReactNode;
  leading?: ReactNode;
  attachments?: ReactNode;
}) {
  const id = useId();
  const input = useRef<HTMLDivElement>(null);
  const caret = useRef(0);
  const [nodes, setNodes] = useState(new Map<string, HTMLElement>());
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    const sorted = [...tokens].sort((a, b) => a.position - b.position);
    const parsed = readEditor(field);
    if (
      parsed.text === value &&
      parsed.positions.length === sorted.length &&
      parsed.positions.every(
        (item, index) =>
          item.id === sorted[index]?.id &&
          item.position === sorted[index]?.position,
      )
    )
      return;
    const fragment = document.createDocumentFragment();
    const next = new Map<string, HTMLElement>();
    let offset = 0;
    for (const [index, token] of sorted.entries()) {
      const position = Math.max(
        offset,
        Math.min(value.length, token.position - index),
      );
      fragment.append(value.slice(offset, position));
      const element = nodes.get(token.id) ?? document.createElement("span");
      element.className = "message-material-token";
      element.contentEditable = "false";
      element.dataset.inlineToken = token.id;
      element.title = token.title ?? "";
      fragment.append(element);
      next.set(token.id, element);
      if (!nodes.has(token.id)) caret.current = token.position + 1;
      offset = position;
    }
    fragment.append(value.slice(offset));
    field.replaceChildren(fragment);
    setNodes(next);
    if (document.activeElement === field) setCaret(field, caret.current);
  }, [nodes, tokens, value]);

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
        {/* biome-ignore lint/a11y/useSemanticElements: Inline noneditable tokens require a contenteditable textbox. */}
        <div
          ref={(node) => {
            input.current = node;
            if (typeof ref === "function") return ref(node);
            if (ref) ref.current = node;
          }}
          id={id}
          role="textbox"
          tabIndex={0}
          aria-label={label}
          aria-multiline="true"
          contentEditable
          suppressContentEditableWarning
          className="message-composer-editor"
          data-placeholder={placeholder}
          data-empty={!value && !tokens.length}
          dir="auto"
          onInput={(event) => {
            const parsed = readEditor(event.currentTarget);
            caret.current = caretOffset(event.currentTarget);
            onValueChange(parsed.text, caret.current, parsed.positions);
          }}
          onSelect={(event) => {
            caret.current = caretOffset(event.currentTarget);
            onCaretChange(caret.current);
          }}
          onFocus={(event) => setCaret(event.currentTarget, caret.current)}
          onPaste={(event) => {
            onPaste?.(event);
            if (event.defaultPrevented) return;
            event.preventDefault();
            document.execCommand(
              "insertText",
              false,
              event.clipboardData.getData("text/plain"),
            );
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented) return;
            const selection = window.getSelection();
            if (
              selection?.isCollapsed &&
              (event.key === "Backspace" || event.key === "Delete") &&
              !event.nativeEvent.isComposing
            ) {
              const offset = caretOffset(event.currentTarget);
              const token = tokens.find(
                (item) =>
                  item.position ===
                  offset - (event.key === "Backspace" ? 1 : 0),
              );
              const node = token && nodes.get(token.id);
              if (node) {
                event.preventDefault();
                const range = document.createRange();
                range.selectNode(node);
                selection.removeAllRanges();
                selection.addRange(range);
                document.execCommand("delete");
                return;
              }
            }
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
        {tokens.map((token) => {
          const node = nodes.get(token.id);
          return node ? createPortal(token.content, node, token.id) : null;
        })}
        <div className="composer-action">{action}</div>
      </div>
    </form>
  );
}
