import { z } from "zod";
import { computerScope } from "../../client.ts";

const schema = z.object({
  key: z.string(),
  cursor: z.string().regex(/^\d+:\d+$/),
  offset: z.number().finite(),
  following: z.boolean(),
});
export type ReadingPosition = z.infer<typeof schema>;
const key = (chat: string) => `domos:reading:v1:${computerScope}:${chat}`;
export function readingPosition(chat: string): ReadingPosition | undefined {
  try {
    return schema.parse(JSON.parse(localStorage.getItem(key(chat)) ?? "null"));
  } catch {
    return undefined;
  }
}
export function saveReadingPosition(chat: string, position: ReadingPosition) {
  try {
    localStorage.setItem(key(chat), JSON.stringify(position));
  } catch {}
}
