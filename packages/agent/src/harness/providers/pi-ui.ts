import type { RpcExtensionUIRequest } from "@earendil-works/pi-coding-agent";
import type { JsonLines } from "../json-lines.ts";
import { type EngineAnswer, type EngineOpen, engineLimits } from "../types.ts";

type Dialog = Extract<
  RpcExtensionUIRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;
export function piUI(rpc: JsonLines, emit: EngineOpen["emit"]) {
  const pending = new Map<string, { request: Dialog; timer: NodeJS.Timeout }>();
  rpc.on("closed", () => {
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
  });
  async function cancel(id: string) {
    const item = pending.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(id);
    await rpc.send({ type: "extension_ui_response", id, cancelled: true });
    await emit({ type: "approval_closed", id });
  }
  return {
    async handle(frame: RpcExtensionUIRequest) {
      switch (frame.method) {
        case "notify":
          await emit({
            type: "runtime",
            state: { notices: { [frame.id]: frame.message } },
          });
          return;
        case "setStatus":
          await emit({
            type: "runtime",
            state: { notices: { [frame.statusKey]: frame.statusText ?? "" } },
          });
          return;
        case "setWidget":
          await emit({
            type: "runtime",
            state: {
              notices: {
                [frame.widgetKey]: frame.widgetLines?.join("\n") ?? "",
              },
            },
          });
          return;
        case "setTitle":
          await emit({
            type: "runtime",
            state: { notices: { [frame.id]: frame.title } },
          });
          return;
        case "set_editor_text":
          await emit({ type: "runtime", state: { editorText: frame.text } });
          return;
      }
      const timer = setTimeout(
        () => {
          void cancel(frame.id).catch((error) => rpc.emit("closed", error));
        },
        "timeout" in frame
          ? (frame.timeout ?? engineLimits.approvalMs)
          : engineLimits.approvalMs,
      );
      timer.unref();
      pending.set(frame.id, { request: frame, timer });
      await emit({
        type: "approval",
        approval: {
          id: frame.id,
          title: frame.title,
          detail: frame.method === "confirm" ? frame.message : "",
          kind: frame.method === "confirm" ? "permission" : "question",
          ...(frame.method === "confirm"
            ? {}
            : {
                questions: [
                  {
                    id: frame.id,
                    title: frame.title,
                    ...(frame.method === "select"
                      ? {
                          options: frame.options.map((value) => ({
                            id: value,
                            label: value,
                          })),
                        }
                      : {}),
                    ...(frame.method === "editor"
                      ? { value: frame.prefill ?? "", multiline: true }
                      : {}),
                  },
                ],
              }),
        },
      });
    },
    async answer(id: string, answer: EngineAnswer) {
      const item = pending.get(id);
      if (!item) throw new Error("这次确认已经失效。");
      if (!answer.allow) {
        await cancel(id);
        return;
      }
      const value = answer.answers?.[id]?.[0] ?? answer.text ?? "";
      if (
        item.request.method === "select" &&
        !item.request.options.includes(value)
      )
        throw new Error("请选择引擎提供的选项。");
      clearTimeout(item.timer);
      pending.delete(id);
      await rpc.send({
        type: "extension_ui_response",
        id,
        ...(item.request.method === "confirm"
          ? { confirmed: true }
          : { value }),
      });
      await emit({ type: "approval_closed", id });
    },
    async interrupt() {
      for (const id of pending.keys()) await cancel(id);
    },
  };
}
