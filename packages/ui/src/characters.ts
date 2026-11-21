export type CharacterMedia = {
  src: string;
  cover: string;
  thumbnail?: string;
  headset: { x: number; y: number; scale: number };
  computer: { x: number; y: number; scale: number };
};

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

export type CharacterShape = keyof typeof characterNames | "cat";
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

const shapes = Object.keys(characterNames) as (keyof typeof characterNames)[];

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
