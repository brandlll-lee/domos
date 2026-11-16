export function removeBackground(
  data: Uint8Array,
  width: number,
  height: number,
  key: number[],
  tolerance?: number,
): Uint8Array;
export function prepareImage(
  path: string,
  output?: string,
  transparent?: boolean,
): Promise<{
  width: number;
  height: number;
  frames: number;
  delay: number[];
  format: string;
}>;
