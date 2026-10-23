import {
  type ConversationId,
  defineDoc,
  InboxDoc,
  LiveDoc,
  type Tx,
} from "@earendil-works/pi-durable";
import { EngineDoc } from "../harness/state.ts";
import type { ComputerConfig } from "../runtime/config.ts";
import { WorkError } from "../work/state.ts";

export type ComputerRecord = {
  id: string;
  name: string;
  config: ComputerConfig;
  authorized: boolean;
  scope?: { kind: "shared" } | { kind: "dedicated"; botId: number };
};

export const ComputersDoc = defineDoc<{
  items: ComputerRecord[];
  defaultId: string | null;
  attachmentComputerId: string | null;
  bindings: Record<
    string,
    {
      computerId: string | null;
      revision: number;
      requestId: string;
      approvalMode?: "ask" | "auto";
      services?: { browser?: boolean; desktop?: boolean };
    }
  >;
}>({
  kind: "domos.computers",
  version: 1,
  scope: "session",
  initial: () => ({
    items: [],
    defaultId: null,
    attachmentComputerId: null,
    bindings: {},
  }),
});

export async function requireIdle(tx: Tx, botId: number) {
  const id = botId as ConversationId;
  if (
    (await tx.doc(LiveDoc, id)).run ||
    (await tx.doc(InboxDoc, id)).items.length ||
    (await tx.doc(EngineDoc, id)).tasks.length
  )
    throw new WorkError("CONFLICT", "请先停止 Bot 的工作，再切换或操作电脑。");
}

export function requireComputer(items: readonly ComputerRecord[], id: string) {
  const item = items.find((item) => item.id === id);
  if (!item) throw new WorkError("NOT_FOUND", "电脑不存在。");
  return item;
}
