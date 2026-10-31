export type BotPanelView =
  | "root"
  | "identity"
  | "engine"
  | "advanced"
  | "computer"
  | "skills"
  | "routines"
  | "prompt";

import type { WorkData } from "./use-bot-work.ts";

export type PanelEditor =
  | {
      view: "skills";
      skill: WorkData["skills"][number] | null;
      content: string;
      archive?: string;
      token: string;
    }
  | {
      view: "routines";
      routine: WorkData["routines"]["items"][number] | null;
      token: string;
    };
