export function cursorTheme(
  source: Uint8Array,
  color: string,
): {
  id: string;
  source: Uint8Array;
};
export function installCursorTheme(
  binary: string,
  home: string,
  color: string,
): Promise<string>;
