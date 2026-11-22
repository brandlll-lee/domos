import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export function useCommandSelection(
  ids: string[],
  scope: string,
  initial?: string,
) {
  const prefix = useId();
  const input = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState({ scope, id: initial });
  const [menuOpen, setMenuOpen] = useState(false);
  const selected =
    selection.scope === scope && ids.includes(selection.id ?? "")
      ? selection.id
      : ids.includes(initial ?? "")
        ? initial
        : ids[0];
  const rowId = (id: string) => `${prefix}-${id}`;
  useEffect(() => {
    setSelection({ scope, id: initial });
    setMenuOpen(false);
  }, [scope, initial]);
  const scrollSelection = useCallback(() => {
    if (selected)
      document
        .getElementById(`${prefix}-${selected}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [prefix, selected]);
  useEffect(scrollSelection, [scrollSelection]);

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing || menuOpen) return;
    if (event.key === "Enter" && event.target === input.current) {
      event.preventDefault();
      if (selected)
        document
          .getElementById(rowId(selected))
          ?.querySelector<HTMLButtonElement>("[data-command-action]")
          ?.click();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!ids.length) return;
      const index = ids.indexOf(selected ?? "");
      const next =
        ids[
          Math.max(
            0,
            Math.min(
              ids.length - 1,
              index + (event.key === "ArrowDown" ? 1 : -1),
            ),
          )
        ];
      setSelection({ scope, id: next });
      input.current?.focus();
    }
  }

  return {
    input,
    onOpenChangeComplete: (open: boolean) => {
      if (open) scrollSelection();
    },
    inputProps: {
      "aria-controls": prefix,
      "aria-activedescendant": selected ? rowId(selected) : undefined,
      onKeyDown: keyDown,
    },
    listProps: { id: prefix, role: "grid" as const },
    menuOpenChange: (id: string, open: boolean) => {
      setMenuOpen(open);
      setSelection({ scope, id });
    },
    rowProps: (id: string) => ({
      id: rowId(id),
      "aria-selected": selected === id,
      "data-highlighted": selected === id || undefined,
      onPointerMove: () => {
        if (!menuOpen) setSelection({ scope, id });
      },
      onFocus: () => {
        if (!menuOpen) setSelection({ scope, id });
      },
    }),
    keyDown,
  };
}
