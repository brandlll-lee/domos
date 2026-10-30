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

type RequestContext = { method: string; phase: string; startedAt: number };

export class EngineRequestRejected extends Error {}

export class JsonLines extends EventEmitter {
  phase = "初始化";
  private readonly process: EngineProcess;
  private readonly pi: boolean;
  private sequence = 0;
  private connected = false;
  private readonly pending = new Map<
    string | number,
    RequestContext & {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer?: NodeJS.Timeout;
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
          if (frame.error || frame.success === false) {
            const native = frame.error as
              | { code?: number; message?: string }
              | undefined;
            pending.reject(
              new EngineRequestRejected(
                `${this.describe(pending)}：${native?.code === -32601 ? "当前引擎版本不支持此请求" : "引擎拒绝请求"}。原生错误：${typeof frame.error === "string" ? frame.error : (native?.message ?? "未提供")}`,
              ),
            );
          } else
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
    if (this.process.input.writableEnded || this.process.input.destroyed)
      return Promise.reject(new Error("引擎连接已关闭。"));
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
    const context = { method, phase: this.phase, startedAt: Date.now() };
    return new Promise<T>((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(
              new Error(
                `${this.describe(context)}：RPC 超时，未收到原生响应。`,
              ),
            );
          }, timeout)
        : undefined;
      timer?.unref();
      this.pending.set(id, {
        ...context,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      void this.send(
        this.pi ? { id, type: method, ...params } : { id, method, params },
      ).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          new Error(`${this.describe(context)}：${error.message}`, {
            cause: error,
          }),
        );
      });
    });
  }

  private describe(request: RequestContext) {
    return `引擎 ${request.phase} / ${request.method}（${Date.now() - request.startedAt}ms）`;
  }

  private fail(error: Error) {
    for (const value of this.pending.values()) {
      clearTimeout(value.timer);
      value.reject(
        new Error(`${this.describe(value)}：${error.message}`, {
          cause: error,
        }),
      );
    }
    this.pending.clear();
    this.emit("closed", error);
  }
}
