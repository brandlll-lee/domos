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
  bunny:
    "M50 40C68 40 80 50 80 64C80 78 68 86 50 86C32 86 20 78 20 64C20 50 32 40 50 40ZM30 46C26 36 24 24 26 16C28 10 34 10 37 15C40 22 42 34 42 44ZM58 44C58 34 61 22 66 15C69 10 76 11 76 17C76 25 74 36 70 46Z",
  ghost:
    "M24 50C24 28 35 12 50 12C65 12 76 28 76 50L77 80C77 85 73 88 68 88C63 88 61 84 59 81C57 84 54 88 50 88C46 88 43 84 41 81C39 84 37 88 32 88C27 88 23 85 23 80Z",
  rocket:
    "M46 10C48 8.5 52 8.5 54 10C64 17 71 29 71 44V72H29V44C29 29 36 17 46 10ZM29 56H71C80 61 86 70 86 80C86 84 83 86 79 85L72 83H28L21 85C17 86 14 84 14 80C14 70 20 61 29 56ZM42 80H58C59 86 55 90 50 92C45 90 41 86 42 80Z",
  controller:
    "M28 22C38 20 44 23 50 23C56 23 62 20 72 22C84 24 90 34 91 48C92 62 91 76 82 80C75 83 69 78 66 72C63 67 58 66 50 66C42 66 37 67 34 72C31 78 25 83 18 80C9 76 8 62 9 48C10 34 16 24 28 22Z",
  sprout:
    "M49.5 19H50.5A3 3 0 0 1 53.5 22V46H46.5V22A3 3 0 0 1 49.5 19ZM49 38C36 41 22.5 36 17.6 23.4A1.4 1.4 0 0 1 18.4 21.6C29 17.5 41.5 21.5 49 34ZM51 30C57 14.5 72 8.5 82.6 11.8A1.4 1.4 0 0 1 83.5 13.4C80.5 27.5 66 35.5 51 34ZM24 44H76A4 4 0 0 1 80 48V54A4 4 0 0 1 76 58H24A4 4 0 0 1 20 54V48A4 4 0 0 1 24 44ZM24 56H76L71 84C70.4 87.5 68 90 64.5 90H35.5C32 90 29.6 87.5 29 84Z",
  chat: "M28 14H72C82 14 90 22 90 32V54C90 64 82 72 72 72H42L25 86C23.5 87.3 21.5 86 22.3 84L27 71.5C17 70 10 63 10 54V32C10 22 18 14 28 14Z",
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
  bunny: "兔子",
  ghost: "幽灵",
  rocket: "火箭",
  controller: "手柄",
  sprout: "幼苗",
  chat: "气泡",
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

export const brandCharacter = {
  color: "#c6f33c",
  shape: "cat",
} as const;

export type CharacterShape = keyof typeof characterShapes | "cat";
export const characterFaces: Partial<
  Record<CharacterShape, { x: number; y: number; scale: number }>
> = {
  bunny: { x: 50, y: 63, scale: 0.85 },
  ghost: { x: 50, y: 43, scale: 0.8 },
  rocket: { x: 50, y: 46, scale: 0.65 },
  controller: { x: 50, y: 42, scale: 0.9 },
  sprout: { x: 50, y: 70, scale: 0.6 },
  chat: { x: 50, y: 42, scale: 1 },
};

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
