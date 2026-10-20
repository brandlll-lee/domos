import { ActivityDetails } from "@domos/ui/activity";
import { Button } from "@domos/ui/controls";
import { useState } from "react";
import { client } from "../../../client.ts";
import type { WorkAction } from "./use-bot-work.ts";

export function PromptPanel({
  botId,
  action,
}: {
  botId: number;
  action: WorkAction;
}) {
  const [prompt, setPrompt] = useState<Awaited<
    ReturnType<typeof client.work.prompt>
  > | null>(null);
  return (
    <section className="detail-page" aria-label="提示词">
      <div className="detail-card detail-prompt-action">
        <div>
          <strong>实际提示词</strong>
        </div>
        <Button
          variant="secondary"
          size="small"
          aria-label="读取实际提示词"
          disabled={action.busy}
          pending={action.busy}
          onClick={() =>
            void action.run(
              ["prompt", botId],
              () => client.work.prompt({ botId }),
              setPrompt,
            )
          }
        >
          读取
        </Button>
      </div>

      {prompt ? (
        prompt.prepared ? (
          <>
            <div className="item-meta prompt-tools">
              <span>工具</span>
              {prompt.tools.length ? (
                prompt.tools.map((tool) => (
                  <span key={tool} className="item-tag">
                    {tool}
                  </span>
                ))
              ) : (
                <span>无</span>
              )}
            </div>
            <div className="prompt-sections">
              {Object.entries(prompt.sections).map(([key, text]) => (
                <ActivityDetails key={key} label={key} status="">
                  <pre className="detail-prompt">{text}</pre>
                </ActivityDetails>
              ))}
              <ActivityDetails label="完整提示词" status="">
                <pre className="detail-prompt">{prompt.text}</pre>
              </ActivityDetails>
            </div>
          </>
        ) : (
          <p className="detail-empty">尚无提示词请求记录。先与此 Bot 对话。</p>
        )
      ) : null}
    </section>
  );
}
