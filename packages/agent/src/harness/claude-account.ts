import type { EngineProcess } from "./types.ts";
import { engineLimits } from "./types.ts";

const connectionCheckError = "Claude Code 连接检查未完成。请检查工作电脑。";

export async function readClaudeAccount(
  worker: EngineProcess,
  env: Record<string, string> = {},
): Promise<boolean> {
  let output = "";
  let timer: NodeJS.Timeout | undefined;
  worker.output.on("data", (chunk) => {
    output = (output + chunk.toString()).slice(-engineLimits.outputCharacters);
  });
  worker.error.resume();
  try {
    const ready = await worker.ready;
    const result = await Promise.race([
      (async () => {
        await worker.launch({
          command: "claude",
          args: ["auth", "status"],
          env: { ...env, CLAUDE_CONFIG_DIR: `${ready.home}/claude` },
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
    const status: unknown = JSON.parse(output);
    if (
      !status ||
      typeof status !== "object" ||
      !("loggedIn" in status) ||
      typeof status.loggedIn !== "boolean" ||
      (result.code !== 0 && !(result.code === 1 && status.loggedIn === false))
    )
      throw new Error(connectionCheckError);
    return status.loggedIn;
  } catch {
    throw new Error(connectionCheckError);
  } finally {
    clearTimeout(timer);
    await worker.close();
  }
}
