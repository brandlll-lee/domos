type Rectangle = { x: number; y: number; width: number; height: number };
export type ComputerEffectState = {
  color: string;
  screen: Rectangle;
  window: Rectangle | null;
  covered: Rectangle[];
  pointer: {
    x: number;
    y: number;
    id: number;
    action: string;
    motion?: { t: number; x: number; y: number }[];
    expiresAt: number;
  } | null;
  expiresAt: number;
};
export function mountComputerEffect(container: HTMLElement): {
  update(value: ComputerEffectState | null): void;
  close(): void;
};
export function mountComputerEffectWithArt(
  container: HTMLElement,
  art: { styles: string; markup: string },
): ReturnType<typeof mountComputerEffect>;
