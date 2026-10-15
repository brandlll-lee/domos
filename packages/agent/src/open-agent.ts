import type { Context } from "@earendil-works/chord/context";
import {
  type AgentChange,
  Harness,
  type HarnessOptions,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

export async function openAgent(
  database: string,
  options: HarnessOptions,
  agent: AgentChange,
  context: Context,
) {
  const storage = await openNodeSqliteStorage(database);
  const harness = await Harness.open(storage, options, context);
  try {
    const conversation = await harness.root(context, { agent });
    harness.resume();
    return { harness, conversation, models: options.models };
  } catch (error) {
    await harness.close(context);
    throw error;
  }
}
