import { useState } from "react";
import { z } from "zod";
import { computerScope } from "../../client.ts";

const schema = z
  .array(z.union([z.literal(""), z.string().regex(/^#[0-9a-f]{6}$/i)]))
  .max(12);
const key = () => `domos:colors:v1:${computerScope}`;

export function useCustomColors() {
  const [colors, setColors] = useState<string[]>(() => {
    try {
      return schema.parse(JSON.parse(localStorage.getItem(key()) ?? "[]"));
    } catch {
      return [];
    }
  });
  return [
    colors,
    (next: string[]) => {
      const saved = Array.from(next, (color) => color ?? "");
      setColors(saved);
      try {
        localStorage.setItem(key(), JSON.stringify(saved));
      } catch {}
    },
  ] as const;
}
