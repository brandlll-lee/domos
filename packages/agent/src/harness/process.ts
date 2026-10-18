import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { PassThrough, Writable } from "node:stream";
import spawn from "cross-spawn";
import {
  type EngineProcess,
  engineLimits,
  type ProcessReady,
  type ProcessSpec,
  type ProductResult,
  type ProductTool,
} from "./types.ts";

export class WorkProcess implements EngineProcess {
  readonly output = new PassThrough();
  readonly error = new PassThrough();
  readonly input: Writable;
  private readonly preparation = Promise.withResolvers<ProcessReady>();
  private readonly started = Promise.withResolvers<void>();
  private readonly ended = Promise.withResolvers<{ code: number | null }>();
  readonly ready = this.preparation.promise;
  readonly closed = this.ended.promise;
  private readonly child: ChildProcessWithoutNullStreams;
  private closing?: Promise<void>;

  constructor(
    command: readonly string[],
    directory: { cwd: string; home: string },
    tools: ProductTool[],
    invoke: (
      callId: string,
      name: string,
      args: Record<string, unknown>,
    ) => Promise<ProductResult>,
  ) {
    const [program, ...args] = command;
    if (!program) throw new Error("引擎启动命令缺失。");
    this.child = spawn(program, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    }) as ChildProcessWithoutNullStreams;
    this.input = new Writable({
      write: (data, _encoding, callback) => {
        this.send({ type: "input", data: data.toString() }).then(
          () => callback(),
          callback,
        );
      },
    });
    this.input.on("error", () => {});
    this.child.stdin?.on("error", () => {});
    this.child.stderr?.resume();
    const lines = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    lines.on("line", (line) => {
      try {
        if (Buffer.byteLength(line) > engineLimits.frameBytes)
          throw new Error("Frame too large");
        const frame = JSON.parse(line);
        if (frame.type === "ready") this.preparation.resolve(frame);
        else if (frame.type === "spawn") this.started.resolve();
        else if (frame.type === "stdout") this.output.write(frame.data);
        else if (frame.type === "stderr") this.error.write(frame.data);
        else if (frame.type === "tool") {
          void invoke(frame.callId, frame.name, frame.args)
            .catch(() => ({
              content: [
                { type: "text" as const, text: "产品工具未完成。请核对结果。" },
              ],
              isError: true,
            }))
            .then((result) =>
              this.send({ type: "result", id: frame.id, result }),
            )
            .catch(() => {});
        } else if (frame.type === "exit") this.finish(frame.code);
        else if (frame.type === "failure") this.fail(new Error(frame.message));
      } catch {
        this.fail(new Error("工作电脑返回了无效数据。"));
      }
    });
    this.child.once("error", () =>
      this.fail(new Error("工作电脑未能启动引擎连接。")),
    );
    this.child.once("close", (code) => {
      lines.close();
      this.finish(code);
    });
    const timer = setTimeout(
      () => this.fail(new Error("工作电脑没有及时响应。请检查连接。")),
      engineLimits.handshakeMs,
    );
    timer.unref();
    void this.ready.then(
      () => clearTimeout(timer),
      () => clearTimeout(timer),
    );
    void this.send({ type: "configure", ...directory, tools }).catch((error) =>
      this.fail(error),
    );
    void this.ready.catch(() => {});
    void this.started.promise.catch(() => {});
  }

  private send(value: unknown) {
    return new Promise<void>((resolve, reject) => {
      this.child.stdin.write(`${JSON.stringify(value)}\n`, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  async launch(spec: ProcessSpec) {
    await this.ready;
    await this.send({ type: "launch", ...spec });
    const timer = setTimeout(
      () => this.fail(new Error("引擎没有及时启动。")),
      engineLimits.handshakeMs,
    );
    timer.unref();
    try {
      await this.started.promise;
    } finally {
      clearTimeout(timer);
    }
  }

  private fail(error: Error) {
    this.preparation.reject(error);
    this.started.reject(error);
    this.finish(1);
    void this.close();
  }

  private finish(code: number | null) {
    const error = new Error("引擎连接已关闭。");
    this.preparation.reject(error);
    this.started.reject(error);
    this.ended.resolve({ code });
    this.output.end();
    this.error.end();
  }

  close() {
    this.closing ??= (async () => {
      const exited = once(this.child, "close").catch(() => {});
      if (this.child.exitCode !== null || this.child.signalCode !== null)
        return;
      await this.send({ type: "close" }).catch(() => {});
      const timer = setTimeout(
        () => this.child.kill(),
        engineLimits.shutdownMs,
      );
      timer.unref();
      await exited;
      clearTimeout(timer);
    })();
    return this.closing;
  }
}
