import { engineProvider } from "./providers/index.ts";
import type {
  EngineOpen,
  EngineProcess,
  EngineSession,
  ProductResult,
} from "./types.ts";

export type TurnHandlers = Pick<EngineOpen, "emit" | "approve"> & {
  invoke: (
    callId: string,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<ProductResult>;
};

export class LiveSession {
  process!: EngineProcess;
  session?: EngineSession;
  handlers?: TurnHandlers;
  account?: string;
  closed = false;
  private calls = 0;

  async start(
    create: (invoke: TurnHandlers["invoke"]) => Promise<EngineProcess>,
  ) {
    this.process = await create(async (...args) => {
      const handlers = this.handlers;
      if (!handlers) throw new Error("任务已结束。");
      this.calls++;
      try {
        return await handlers.invoke(...args);
      } finally {
        this.calls--;
      }
    });
    void this.process.closed.then(() => {
      this.closed = true;
      this.handlers = undefined;
    });
  }

  async initialize(input: Omit<EngineOpen, "process" | "emit" | "approve">) {
    this.session ??= await engineProvider(input.config.provider).open({
      ...input,
      process: this.process,
      emit: (event) => this.handlers?.emit(event) ?? Promise.resolve(),
      approve: (approval) =>
        this.handlers?.approve?.(approval) ?? Promise.resolve({ allow: false }),
    });
    return this.session;
  }

  release() {
    this.handlers = undefined;
    return !this.closed && this.calls === 0;
  }
}
