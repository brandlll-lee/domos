import { z } from "zod";
import type { EngineProcess } from "./types.ts";
import { engineLimits } from "./types.ts";

export async function readCliAccount(
  worker: EngineProcess,
  provider: "claude" | "cursor",
  env: Record<string, string> = {},
  command = provider === "claude" ? "claude" : "cursor-agent",
): Promise<boolean> {
  const connectionCheckError = `${provider === "claude" ? "Claude Code" : "Cursor"} 连接检查未完成。请检查工作电脑。`;
  const field = provider === "claude" ? "loggedIn" : "isAuthenticated";
  let output = "";
  let timer: NodeJS.Timeout | undefined;
  worker.output.on("data", (chunk) => {
    output = (output + chunk.toString()).slice(-engineLimits.outputCharacters);
  });
  worker.error.resume();
  try {
    const result = await Promise.race([
      (async () => {
        await worker.launch({
          command,
          args:
            provider === "claude"
              ? ["auth", "status"]
              : ["status", "--format", "json"],
          env,
        });
        return worker.closed;
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(connectionCheckError)),
          engineLimits.handshakeMs,
        );
        timer.unref();
      }),
    ]);
    const status = z.object({ [field]: z.boolean() }).parse(JSON.parse(output));
    if (result.code !== 0 && !(result.code === 1 && status[field] === false))
      throw new Error(connectionCheckError);
    return status[field] === true;
  } catch {
    throw new Error(connectionCheckError);
  } finally {
    clearTimeout(timer);
    await worker.close();
  }
}
