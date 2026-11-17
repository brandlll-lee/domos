import {
  type ClientSideConnection,
  type ContentBlock,
  type PromptResponse,
  RequestError,
} from "@agentclientprotocol/sdk";

type Submission = {
  text: string;
  reply: Promise<PromptResponse>;
  admitted: ReturnType<
    typeof Promise.withResolvers<"accepted" | "refused" | "uncertain">
  >;
};

export class AcpPrompts {
  private readonly submissions: Submission[] = [];
  private running = false;
  private userText = "";
  constructor(
    private readonly rpc: ClientSideConnection,
    private readonly sessionId: string,
  ) {}

  observe(text: string) {
    this.userText += text;
    for (const item of this.submissions)
      if (item.text && this.userText === item.text)
        item.admitted.resolve("accepted");
  }

  private send(prompt: ContentBlock[]) {
    const admitted = Promise.withResolvers<
      "accepted" | "refused" | "uncertain"
    >();
    const item: Submission = {
      text: prompt
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
      admitted,
      reply: this.rpc.prompt({ sessionId: this.sessionId, prompt }),
    };
    this.submissions.push(item);
    void item.reply.then(
      () => admitted.resolve("accepted"),
      (error) =>
        admitted.resolve(
          error instanceof RequestError ? "refused" : "uncertain",
        ),
    );
    return item;
  }

  async run(prompt: ContentBlock[]) {
    if (this.running) throw new Error("原生会话仍在工作。");
    this.running = true;
    this.submissions.length = 0;
    this.userText = "";
    this.send(prompt);
    let result: PromptResponse = { stopReason: "end_turn" };
    try {
      for (let index = 0; index < this.submissions.length; index++) {
        const item = this.submissions[index];
        if (!item) continue;
        try {
          result = await item.reply;
        } catch (error) {
          if (index === 0 || !(error instanceof RequestError)) throw error;
        }
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  async steer(prompt: ContentBlock[], replacesPrompt: boolean) {
    if (!this.running) return "refused" as const;
    const previous = this.submissions.at(-1);
    const item = this.send(prompt);
    if (replacesPrompt && previous)
      void previous.reply.then(
        () => item.admitted.resolve("accepted"),
        () => {},
      );
    const timer = setTimeout(() => item.admitted.resolve("uncertain"), 3000);
    timer.unref();
    try {
      return await item.admitted.promise;
    } finally {
      clearTimeout(timer);
    }
  }
}
