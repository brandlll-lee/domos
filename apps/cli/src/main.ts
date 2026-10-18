import { createInterface, type Interface } from "node:readline";
import { openChat } from "@domos/agent/chat";
import { messageText } from "@domos/agent/messages";
import { chatView } from "@domos/agent/view";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { reply } from "./chat.ts";

async function main() {
  const runtime = await openChat(BACKGROUND_CONTEXT);
  const { conversation } = runtime;
  const cancellation = new AbortController();
  const context = withAbortSignal(cancellation.signal, BACKGROUND_CONTEXT);
  let terminal: Interface | undefined;
  const stop = () => {
    cancellation.abort();
    terminal?.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const send = async (input: string) => {
    process.stdout.write("Domos> ");
    const success = await reply(
      conversation,
      input,
      context,
      (text) => {
        process.stdout.write(text);
      },
      runtime.engines,
    );
    process.stdout.write("\n");
    if (!success) {
      console.error("模型未完成回复。请检查密钥、账户余额或网络。");
      process.exitCode = 1;
    }
  };
  try {
    const input = process.argv.slice(2).join(" ").trim();
    if (input) {
      await send(input);
      return;
    }
    await conversation.waitForIdle(context);
    const history = await conversation.viewState(context);
    const messages = runtime.engines
      ? (await runtime.engines.view(conversation.id, context)).messages
      : chatView(history.value).messages;
    history.dispose();
    for (const message of messages) {
      if (message.role === "user" || message.role === "assistant") {
        const text = messageText(message);
        if (text)
          console.log(`${message.role === "user" ? "你" : "Domos"}> ${text}`);
      }
    }
    console.log("输入消息。Ctrl+C 保存并退出。");
    terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    terminal.once("SIGINT", stop);
    terminal.setPrompt("你> ");
    terminal.prompt();
    for await (const line of terminal) {
      if (line.trim()) await send(line.trim());
      terminal.prompt();
    }
  } catch (error) {
    if (!cancellation.signal.aborted) throw error;
    process.exitCode = 130;
  } finally {
    terminal?.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await runtime.close();
  }
}

main().catch(() => {
  console.error("启动失败。请检查模型配置、Node 版本和数据目录。");
  process.exitCode = 1;
});
