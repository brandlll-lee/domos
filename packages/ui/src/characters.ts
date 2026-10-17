export const characterShapes = {
  soft: "M95.00 50.00C95.00 55.91 94.70 62.14 92.78 67.72C90.87 73.31 87.68 79.33 83.51 83.51C79.33 87.68 73.31 90.87 67.72 92.78C62.14 94.70 55.91 95.00 50.00 95.00C44.09 95.00 37.86 94.70 32.28 92.78C26.69 90.87 20.67 87.68 16.49 83.51C12.32 79.33 9.13 73.31 7.22 67.72C5.30 62.14 5.00 55.91 5.00 50.00C5.00 44.09 5.30 37.86 7.22 32.28C9.13 26.69 12.32 20.67 16.49 16.49C20.67 12.32 26.69 9.13 32.28 7.22C37.86 5.30 44.09 5.00 50.00 5.00C55.91 5.00 62.14 5.30 67.72 7.22C73.31 9.13 79.33 12.32 83.51 16.49C87.68 20.67 90.87 26.69 92.78 32.28C94.70 37.86 95.00 44.09 95.00 50.00Z",
  round: "M95 50A45 45 0 1 1 5 50A45 45 0 1 1 95 50Z",
  drop: "M50 5C62 5 94 48 94 64C94 107 6 107 6 64C6 48 38 5 50 5Z",
  triangle: "M40 13Q50 -1 60 13L94 75Q103 93 82 93H18Q-3 93 6 75Z",
  heart: "M50 23C20 -10 -9 26 12 55L50 92L88 55C109 26 80 -10 50 23Z",
  hex: "M39 7Q50 1 61 7L88 24Q96 29 96 40V60Q96 71 88 76L61 93Q50 99 39 93L12 76Q4 71 4 60V40Q4 29 12 24Z",
  star: "M50.00 7.00C55.68 7.00 60.07 22.47 67.05 27.54C74.02 32.61 90.09 32.00 91.85 37.40C93.60 42.81 80.24 51.76 77.58 59.96C74.92 68.16 80.46 83.26 75.86 86.60C71.27 89.94 58.62 80.00 50.00 80.00C41.38 80.00 28.73 89.94 24.14 86.60C19.54 83.26 25.08 68.16 22.42 59.96C19.76 51.76 6.40 42.81 8.15 37.40C9.91 32.00 25.98 32.61 32.95 27.54C39.93 22.47 44.32 7.00 50.00 7.00Z",
} as const;

export const characterColors = [
  "#ec785f",
  "#e4b347",
  "#b48363",
  "#569ae3",
  "#32bba6",
  "#9875dc",
  "#d875a1",
  "#798995",
] as const;

export const characterBaseColor = "#b3df32";
export const brandCharacter = {
  color: characterBaseColor,
  shape: "cat",
} as const;

export type CharacterShape = keyof typeof characterShapes | "cat";

export function characterIdentity(seed: string) {
  let hash = 2166136261;
  for (const character of seed)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const shapes = Object.keys(
    characterShapes,
  ) as (keyof typeof characterShapes)[];
  return {
    shape: shapes[(hash >>> 0) % shapes.length] ?? "soft",
    color:
      characterColors[((hash >>> 0) >>> 8) % characterColors.length] ??
      characterColors[0],
  };
}
