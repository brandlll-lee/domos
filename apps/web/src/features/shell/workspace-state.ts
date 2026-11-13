import { z } from "zod";
import { computerScope } from "../../client.ts";

const panelSchema = z.object({
  open: z.boolean(),
  tab: z.enum(["settings", "computer", "browser", "work", "file"]),
  detail: z.enum([
    "root",
    "identity",
    "engine",
    "advanced",
    "computer",
    "assistance",
    "skills",
    "routines",
    "prompt",
    "files",
  ]),
  fileBotId: z.number().int().nonnegative().optional(),
  file: z
    .object({
      id: z.string(),
      name: z.string(),
      size: z.number(),
      path: z.string(),
      mimeType: z.string().optional(),
      computerId: z.string().optional(),
      directory: z.string().optional(),
      display: z.literal("inline").optional(),
    })
    .optional(),
});
const schema = z.object({
  contact: z
    .string()
    .regex(/^#(?:bot\/\d+|team\/.+)$/)
    .optional(),
  panels: z.record(z.string(), panelSchema).default({}),
});
type WorkspaceView = z.infer<typeof schema>;
const key = () => `domos:workspace:v1:${computerScope}`;
export function workspaceView(): WorkspaceView {
  try {
    return schema.parse(JSON.parse(localStorage.getItem(key()) ?? "{}"));
  } catch {
    return { panels: {} };
  }
}
export function saveWorkspaceView(patch: Partial<WorkspaceView>) {
  try {
    const previous = workspaceView();
    localStorage.setItem(
      key(),
      JSON.stringify({
        ...previous,
        ...patch,
        panels: { ...previous.panels, ...patch.panels },
      }),
    );
  } catch {}
}
