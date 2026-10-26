import type {
  ViewerAction,
  ViewFrame,
} from "@domos/agent/computer/viewer-types";
import { useCallback, useEffect, useRef } from "react";
import { viewportPoint } from "./viewer-input.ts";

export function ComputerViewport({
  frame,
  browser,
  driving,
  send,
  onDraft,
  onLoad,
}: {
  frame: ViewFrame;
  browser: boolean;
  driving: boolean;
  send: (action: ViewerAction) => Promise<boolean>;
  onDraft: (text: string) => void;
  onLoad: (image: HTMLImageElement) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  const receiver = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const pointer = useRef<number | undefined>(undefined);
  const src = `data:${frame.mimeType};base64,${frame.data}`;
  const cancel = useCallback(() => {
    if (pointer.current === undefined) return;
    const id = pointer.current;
    pointer.current = undefined;
    if (image.current?.hasPointerCapture(id))
      image.current.releasePointerCapture(id);
    void send({
      type: "pointer",
      event: "cancel",
      x: 0,
      y: 0,
      button: "left",
      deltaX: 0,
      deltaY: 0,
    });
  }, [send]);
  useEffect(() => {
    const blur = () => {
      cancel();
      const input = receiver.current;
      if (input?.value) {
        onDraft(input.value);
        input.value = "";
      }
      composing.current = false;
    };
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      cancel();
    };
  }, [cancel, onDraft]);
  useEffect(() => {
    if (!driving) cancel();
  }, [driving, cancel]);
  const point = useCallback(
    (x: number, y: number, captured = false) => {
      const node = image.current;
      if (!driving || !node?.complete || node.currentSrc !== src) return;
      return viewportPoint(
        node,
        node.getBoundingClientRect(),
        frame,
        x,
        y,
        browser,
        captured,
      );
    },
    [driving, src, frame, browser],
  );
  useEffect(() => {
    const node = image.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      const at = point(event.clientX, event.clientY);
      if (!at) return;
      event.preventDefault();
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? (node.naturalHeight * frame.width) / node.naturalWidth
            : 1;
      const clamp = (n: number) => Math.max(-10000, Math.min(10000, n * unit));
      void send({
        type: "pointer",
        event: "scroll",
        ...at,
        button: "left",
        deltaX: clamp(event.deltaX),
        deltaY: clamp(event.deltaY),
      });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [frame, point, send]);
  const type = (text: string) => {
    if (!text || !driving) return;
    void send({ type: "text", text }).then((ok) => {
      if (!ok) onDraft(text);
    });
  };
  return (
    <>
      <img
        ref={image}
        src={src}
        alt="工作电脑画面"
        draggable={false}
        onLoad={(event) => onLoad(event.currentTarget)}
        onContextMenu={(event) => {
          if (driving) event.preventDefault();
        }}
        onPointerDown={(event) => {
          const at = point(event.clientX, event.clientY);
          if (!at) return;
          event.preventDefault();
          receiver.current?.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          pointer.current = event.pointerId;
          void send({
            type: "pointer",
            event: "down",
            ...at,
            button:
              event.button === 2
                ? "right"
                : event.button === 1
                  ? "middle"
                  : "left",
            deltaX: 0,
            deltaY: 0,
          });
        }}
        onPointerMove={(event) => {
          const at = point(
            event.clientX,
            event.clientY,
            pointer.current !== undefined,
          );
          if (at)
            void send({
              type: "pointer",
              event: "move",
              ...at,
              button: "left",
              deltaX: 0,
              deltaY: 0,
            });
        }}
        onPointerUp={(event) => {
          if (pointer.current !== event.pointerId) return;
          const at = point(event.clientX, event.clientY, true);
          if (!at) {
            cancel();
            return;
          }
          pointer.current = undefined;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          void send({
            type: "pointer",
            event: "up",
            ...at,
            button:
              event.button === 2
                ? "right"
                : event.button === 1
                  ? "middle"
                  : "left",
            deltaX: 0,
            deltaY: 0,
          });
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
      />
      <textarea
        ref={receiver}
        className="computer-view-input"
        aria-label="网页键盘输入"
        aria-description="点击网页后输入。Shift+Escape 返回工具栏。"
        disabled={!driving}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        onBlur={cancel}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          type(event.currentTarget.value || event.data);
          event.currentTarget.value = "";
        }}
        onInput={(event) => {
          if (
            composing.current ||
            (event.nativeEvent as InputEvent).isComposing
          )
            return;
          type(event.currentTarget.value);
          event.currentTarget.value = "";
        }}
        onPaste={(event) => {
          if (driving) {
            event.preventDefault();
            type(event.clipboardData.getData("text/plain"));
          }
        }}
        onKeyDown={(event) => {
          if (driving) event.stopPropagation();
          if (
            !driving ||
            composing.current ||
            event.nativeEvent.isComposing ||
            event.key === "Process"
          )
            return;
          if (event.shiftKey && event.key === "Escape") {
            event.preventDefault();
            receiver.current?.blur();
            image.current
              ?.closest(".computer-viewer")
              ?.querySelector<HTMLButtonElement>(
                ".computer-view-toolbar button",
              )
              ?.focus();
            return;
          }
          if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "v"
          )
            return;
          if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          )
            return;
          event.preventDefault();
          void send({
            type: "key",
            key: event.key,
            modifiers:
              Number(event.altKey) +
              2 * Number(event.ctrlKey) +
              4 * Number(event.metaKey) +
              8 * Number(event.shiftKey),
          });
        }}
      />
    </>
  );
}
