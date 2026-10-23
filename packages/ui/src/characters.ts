export const characterShapes = {
  soft: "M95.00 50.00C95.00 55.91 94.70 62.14 92.78 67.72C90.87 73.31 87.68 79.33 83.51 83.51C79.33 87.68 73.31 90.87 67.72 92.78C62.14 94.70 55.91 95.00 50.00 95.00C44.09 95.00 37.86 94.70 32.28 92.78C26.69 90.87 20.67 87.68 16.49 83.51C12.32 79.33 9.13 73.31 7.22 67.72C5.30 62.14 5.00 55.91 5.00 50.00C5.00 44.09 5.30 37.86 7.22 32.28C9.13 26.69 12.32 20.67 16.49 16.49C20.67 12.32 26.69 9.13 32.28 7.22C37.86 5.30 44.09 5.00 50.00 5.00C55.91 5.00 62.14 5.30 67.72 7.22C73.31 9.13 79.33 12.32 83.51 16.49C87.68 20.67 90.87 26.69 92.78 32.28C94.70 37.86 95.00 44.09 95.00 50.00Z",
  round: "M95 50A45 45 0 1 1 5 50A45 45 0 1 1 95 50Z",
  drop: "M50 5C62 5 94 48 94 64C94 107 6 107 6 64C6 48 38 5 50 5Z",
  triangle: "M40 13Q50 -1 60 13L94 75Q103 93 82 93H18Q-3 93 6 75Z",
  heart: "M50 23C20 -10 -9 26 12 55L50 92L88 55C109 26 80 -10 50 23Z",
  hex: "M39 7Q50 1 61 7L88 24Q96 29 96 40V60Q96 71 88 76L61 93Q50 99 39 93L12 76Q4 71 4 60V40Q4 29 12 24Z",
  star: "M50.00 7.00C55.68 7.00 60.07 22.47 67.05 27.54C74.02 32.61 90.09 32.00 91.85 37.40C93.60 42.81 80.24 51.76 77.58 59.96C74.92 68.16 80.46 83.26 75.86 86.60C71.27 89.94 58.62 80.00 50.00 80.00C41.38 80.00 28.73 89.94 24.14 86.60C19.54 83.26 25.08 68.16 22.42 59.96C19.76 51.76 6.40 42.81 8.15 37.40C9.91 32.00 25.98 32.61 32.95 27.54C39.93 22.47 44.32 7.00 50.00 7.00Z",
  capsule: "M35 17H65A33 33 0 0 1 65 83H35A33 33 0 0 1 35 17Z",
  cloud:
    "M24 85C11 85 3 76 3 63C3 52 9 44 19 41C15 25 27 13 42 17C50 4 70 9 74 25C91 22 103 39 95 54C106 69 94 85 79 85Z",
} as const;

export const characterNames = {
  soft: "软方",
  round: "圆球",
  drop: "水滴",
  triangle: "圆角三角",
  heart: "爱心",
  hex: "六边形",
  star: "星形",
  capsule: "胶囊",
  cloud: "云团",
} as const;

export const characterColors = [
  { name: "珊瑚红", color: "#ff776b" },
  { name: "莓果红", color: "#fa638a" },
  { name: "蜜桃粉", color: "#ffa595" },
  { name: "杏橙", color: "#ffb675" },
  { name: "鲜橙", color: "#ff994f" },
  { name: "琥珀黄", color: "#f8bd3e" },
  { name: "柠檬黄", color: "#f4df57" },
  { name: "青柠绿", color: "#c6e95b" },
  { name: "嫩绿", color: "#91df74" },
  { name: "薄荷绿", color: "#7ce6bc" },
  { name: "翡翠绿", color: "#46d99e" },
  { name: "松石青", color: "#4dd9cc" },
  { name: "湖青", color: "#62d5e9" },
  { name: "天蓝", color: "#7bc6ff" },
  { name: "晴蓝", color: "#659fff" },
  { name: "长春花紫", color: "#a79aff" },
  { name: "丁香紫", color: "#c7a0f6" },
  { name: "樱粉", color: "#f69dd1" },
] as const;

const seedColors = [
  "#ff8b70",
  "#f5c85a",
  "#dfaa7b",
  "#68b6ff",
  "#4bdec2",
  "#b39aff",
  "#f68fb8",
  "#9dabb8",
] as const;

export const characterBaseColor = "#b3df32";
export const brandCharacter = {
  color: "#c6f33c",
  shape: "cat",
} as const;

export type CharacterShape = keyof typeof characterShapes | "cat";
const shapes = Object.keys(characterShapes) as (keyof typeof characterShapes)[];

export function characterSeed(
  shape = shapes[Math.floor(Math.random() * shapes.length)] ?? "soft",
  color: string = characterColors[
    Math.floor(Math.random() * characterColors.length)
  ]?.color ?? characterColors[0].color,
) {
  return `d090${shapes.indexOf(shape).toString(16).padStart(4, "0")}-0000-8000-8000-${color.slice(1)}000000`;
}

export function characterIdentity(seed: string) {
  const selected =
    /^d090([0-9a-f]{4})-0000-8000-8000-([0-9a-f]{6})000000$/.exec(seed);
  const shape = selected && shapes[Number.parseInt(selected[1] ?? "", 16)];
  if (shape) return { shape, color: `#${selected[2]}` };
  let hash = 2166136261;
  for (const character of seed)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return {
    shape: shapes[(hash >>> 0) % 7] ?? "soft",
    color:
      seedColors[((hash >>> 0) >>> 8) % seedColors.length] ?? seedColors[0],
  };
}
