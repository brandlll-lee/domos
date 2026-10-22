import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import type { ComponentProps, ReactNode, Ref } from "react";

export function ScrollArea({
  children,
  className = "",
  viewportClassName = "",
  viewportRef,
  orientation = "vertical",
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  viewportClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
  orientation?: "vertical" | "horizontal";
}) {
  return (
    <BaseScrollArea.Root className={`scroll-root ${className}`} {...props}>
      <BaseScrollArea.Viewport
        ref={viewportRef}
        className={`scroll-viewport ${viewportClassName}`}
      >
        <BaseScrollArea.Content
          style={{
            minWidth: 0,
            width: orientation === "horizontal" ? "max-content" : "100%",
          }}
        >
          {children}
        </BaseScrollArea.Content>
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar
        className="scroll-bar"
        orientation={orientation}
      >
        <BaseScrollArea.Thumb className="scroll-thumb" />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Corner />
    </BaseScrollArea.Root>
  );
}
