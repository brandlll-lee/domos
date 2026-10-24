import type { JsonLines } from "../json-lines.ts";
import type { CodexItem, CodexTurn } from "./codex-wire.ts";

export async function readCodexTurn(
  rpc: JsonLines,
  threadId: string,
  turnId: string,
) {
  let cursor: string | undefined;
  const seen = new Set<string>();
  let turn: CodexTurn | undefined;
  do {
    const page = await rpc.request<{
      data: CodexTurn[];
      nextCursor?: string | null;
    }>("thread/turns/list", {
      threadId,
      limit: 50,
      itemsView: "notLoaded",
      sortDirection: "desc",
      cursor,
    });
    turn = page.data.find((item) => item.id === turnId);
    if (turn || !page.nextCursor) break;
    if (seen.has(page.nextCursor))
      throw new Error("Codex 历史游标重复。执行结果未确认。");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (seen.size < 256);
  if (turn?.status !== "completed") return undefined;
  cursor = undefined;
  seen.clear();
  const items: CodexItem[] = [];
  let bytes = 0;
  do {
    const page: { data: { item: CodexItem }[]; nextCursor?: string | null } =
      await rpc.request("thread/items/list", {
        threadId,
        turnId,
        limit: 16,
        sortDirection: "asc",
        cursor,
      });
    for (const { item } of page.data) {
      if (!["agentMessage", "contextCompaction"].includes(item.type)) continue;
      bytes += Buffer.byteLength(item.text ?? "");
      if (bytes > 8 * 1024 * 1024)
        throw new Error("Codex 本轮恢复内容过大。原生记录已保留。");
      items.push(item);
    }
    if (!page.nextCursor) return { ...turn, items };
    if (seen.has(page.nextCursor))
      throw new Error("Codex 历史游标重复。执行结果未确认。");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (seen.size < 256);
  throw new Error("Codex 本轮恢复范围过大。原生记录已保留。");
}
