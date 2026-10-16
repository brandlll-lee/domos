import { randomUUID } from "node:crypto";
import type {
  AuthEvent,
  AuthPrompt,
  AuthType,
  Models,
} from "@earendil-works/pi-ai";

type Prompt = {
  id: string;
  type: string;
  message: string;
  options?: readonly { id: string; label: string }[];
};
type Flow = {
  owner: string;
  controller: AbortController;
  events: (AuthEvent & { id: string })[];
  prompt?: Prompt;
  answer?: (value: string) => void;
  done: boolean;
  error?: string;
  expires: number;
};

export class ModelLogins {
  private readonly flows = new Map<string, Flow>();
  readonly models: Models;
  constructor(models: Models) {
    this.models = models;
  }

  start(owner: string, provider: string, type: AuthType) {
    this.prune();
    if (this.flows.size >= 8) throw new Error("请先结束当前登录。");
    const id = randomUUID();
    const flow: Flow = {
      owner,
      controller: new AbortController(),
      events: [],
      done: false,
      expires: Date.now() + 10 * 60_000,
    };
    this.flows.set(id, flow);
    const prompt = (input: AuthPrompt) =>
      new Promise<string>((resolve, reject) => {
        const signal = input.signal
          ? AbortSignal.any([input.signal, flow.controller.signal])
          : flow.controller.signal;
        flow.prompt = {
          id: randomUUID(),
          type: input.type,
          message: input.message,
          ...("options" in input ? { options: input.options } : {}),
        };
        const abort = () => {
          flow.prompt = undefined;
          reject(new Error("登录已取消。"));
        };
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
        flow.answer = (value) => {
          signal.removeEventListener("abort", abort);
          flow.prompt = undefined;
          flow.answer = undefined;
          resolve(value);
        };
      });
    void this.models
      .login(
        provider,
        type,
        {
          prompt,
          notify: (event) => {
            flow.events.push({ ...event, id: randomUUID() });
          },
          signal: flow.controller.signal,
        },
        { agentName: "Domos" },
      )
      .then(() => {
        flow.done = true;
      })
      .catch(() => {
        flow.error = "登录未完成。请检查凭据或重新登录。";
        flow.done = true;
      });
    return { id };
  }

  get(id: string, owner: string) {
    this.prune();
    const flow = this.flows.get(id);
    if (!flow || flow.owner !== owner) throw new Error("登录流程已结束。");
    return flow;
  }

  status(id: string, owner: string) {
    const { events, prompt, done, error } = this.get(id, owner);
    return { events, prompt, done, error };
  }

  cancel(owner: string) {
    for (const [id, flow] of this.flows)
      if (flow.owner === owner) {
        flow.controller.abort();
        this.flows.delete(id);
      }
  }

  close() {
    for (const flow of this.flows.values()) flow.controller.abort();
    this.flows.clear();
  }

  private prune() {
    for (const [id, flow] of this.flows)
      if (flow.expires <= Date.now()) {
        flow.controller.abort();
        this.flows.delete(id);
      }
  }
}
