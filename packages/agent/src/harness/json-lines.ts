import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { EngineProcess } from "./types.ts";
import { engineLimits } from "./types.ts";

type Frame = {
  id?: string | number;
  type?: string;
  result?: unknown;
  data?: unknown;
  success?: boolean;
  error?: unknown;
};

export class EngineRequestRejected extends Error {}

export class JsonLines extends EventEmitter {
  private readonly process: EngineProcess;
  private readonly pi: boolean;
  private sequence = 0;
  private connected = false;
  private readonly pending = new Map<
    string | number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer?: NodeJS.Timeout;
      method: string;
    }
  >();

  constructor(process: EngineProcess, pi = false) {
    super();
    this.process = process;
    this.pi = pi;
    const lines = createInterface({
      input: process.output,
      crlfDelay: Infinity,
    });
    lines.on("line", (line) => {
      try {
        if (Buffer.byteLength(line) > engineLimits.frameBytes)
          throw new Error(
            `引擎协议响应过大（${[...this.pending.values()].map((request) => request.method).join("、") || "实时事件"}）。原生会话已保留，请核对执行结果。`,
          );
        const frame: Frame = JSON.parse(line);
        this.connected = true;
        const pending =
          frame.id === undefined ? undefined : this.pending.get(frame.id);
        if (
          pending &&
          (frame.type === "response" || "result" in frame || "error" in frame)
        ) {
          if (frame.id !== undefined) this.pending.delete(frame.id);
          clearTimeout(pending.timer);
          if (frame.error || frame.success === false)
            pending.reject(
              new EngineRequestRejected(
                (frame.error as { code?: number } | undefined)?.code === -32601
                  ? `当前引擎版本不支持 ${pending.method}。请更新工作电脑的 CLI。`
                  : `引擎拒绝了 ${pending.method} 请求。请检查模型和工作电脑。`,
              ),
            );
          else
            pending.resolve(
              this.pi ? (frame.data ?? {}) : (frame.result ?? {}),
            );
        } else this.emit("frame", frame);
      } catch (error) {
        this.fail(
          error instanceof Error ? error : new Error("引擎返回了无效数据。"),
        );
      }
    });
    void process.closed.then(() => {
      lines.close();
      this.fail(
        new Error(
          this.connected
            ? "引擎连接已关闭。请核对任务结果。"
            : "引擎未能启动。请检查安装和工作电脑。",
        ),
      );
    });
  }

  send(frame: object) {
    return new Promise<void>((resolve, reject) => {
      this.process.input.write(`${JSON.stringify(frame)}\n`, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  request<T = Record<string, unknown>>(
    method: string,
    params: object = {},
    timeout = engineLimits.handshakeMs as number,
  ) {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error("引擎没有及时响应。请核对任务状态。"));
          }, timeout)
        : undefined;
      timer?.unref();
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      void this.send(
        this.pi ? { id, type: method, ...params } : { id, method, params },
      ).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private fail(error: Error) {
    for (const value of this.pending.values()) {
      clearTimeout(value.timer);
      value.reject(error);
    }
    this.pending.clear();
    this.emit("closed", error);
  }
}
