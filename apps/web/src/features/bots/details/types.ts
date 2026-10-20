export type BotPanelView =
  | "root"
  | "identity"
  | "engine"
  | "computer"
  | "memory"
  | "skills"
  | "routines"
  | "prompt";

import type { WorkData } from "./use-bot-work.ts";

export type PanelEditor =
  | { view: "memory"; entry: WorkData["memory"][number] | "new" }
  | {
      view: "skills";
      skill: WorkData["skills"][number] | null;
      content: string;
      token: string;
    }
  | {
      view: "routines";
      routine: WorkData["routines"]["items"][number] | null;
      token: string;
    };
