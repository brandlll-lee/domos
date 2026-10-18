export type CodexItem = {
  id: string;
  type: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  command?: string;
  changes?: unknown;
  text?: string;
  aggregatedOutput?: string;
  result?: unknown;
  status?: string;
  error?: unknown;
};
export type CodexTurn = {
  id: string;
  status: string;
  items?: CodexItem[];
};
export type CodexFrame = {
  id?: string | number;
  method: string;
  params?: {
    itemId?: string;
    delta?: string;
    item?: CodexItem;
    turn?: CodexTurn;
    questions?: { id: string; question: string }[];
    permissions?: Record<string, unknown>;
    command?: string;
    cwd?: string;
    reason?: string;
  };
};
export const codexApprovals = new Set([
  "item/tool/requestUserInput",
  "item/permissions/requestApproval",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
]);
