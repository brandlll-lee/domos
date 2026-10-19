import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import type { EngineProcess, ProcessSpec } from "../../src/harness/types.ts";

export type Request = {
  id?: string | number;
  type?: string;
  method?: string;
  params?: Record<string, unknown>;
  message?: { content: string };
  result?: unknown;
};

export class ProtocolProcess implements EngineProcess {
  readonly input = new PassThrough();
  readonly output = new PassThrough();
  readonly error = new PassThrough();
  readonly ready = Promise.resolve({
    url: "http://127.0.0.1:12345/mcp/test",
    cwd: "/work/bots/1",
    home: "/work/accounts",
  });
  readonly ended = Promise.withResolvers<{ code: number | null }>();
  readonly closed = this.ended.promise;
  readonly requests: Request[] = [];
  spec?: ProcessSpec;
  receive: (request: Request) => void = () => {};
  history: (sessionId: string) => Promise<unknown[]> = async () => {
    throw new Error("History unavailable");
  };

  constructor(mode: "protocol" | "cli" = "protocol") {
    if (mode === "cli") return;
    const lines = createInterface({ input: this.input });
    lines.on("line", (line) => {
      const request: Request = JSON.parse(line);
      this.requests.push(request);
      this.receive(request);
    });
  }
  frame(value: object) {
    this.output.write(`${JSON.stringify(value)}\n`);
  }
  response(request: Request, result: object) {
    this.frame({ jsonrpc: "2.0", id: request.id, result });
  }
  async launch(spec: ProcessSpec) {
    this.spec = spec;
    if (spec.command === "pi") this.frame({ type: "domos_ready" });
    if (spec.args.includes("--version")) {
      this.output.write("test-cli 1.0.0\n");
      this.ended.resolve({ code: 0 });
    }
  }
  async request<T = unknown>(
    _path: string,
    _method?: string,
    _body?: unknown,
  ): Promise<T> {
    if (/^\/session\/[^/]+\/message$/.test(_path)) return [] as T;
    throw new Error("Service unavailable");
  }
  async close() {
    this.input.end();
    this.output.end();
    this.error.end();
    this.ended.resolve({ code: 0 });
  }
}
