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
    <div className="detail-stack">
      <p className="detail-note">
        查看最近交给引擎的指令和产品工具。引擎自带的指令不在此处。此处可能含有私人记忆，请谨慎分享。
      </p>
      <Button
        variant="secondary"
        size="small"
        disabled={action.busy}
        onClick={() =>
          void action.run(
            ["prompt", botId],
            () => client.work.prompt({ botId }),
            setPrompt,
          )
        }
      >
        读取实际提示词
      </Button>
      {prompt &&
        (prompt.prepared ? (
          <>
            <p className="detail-note">工具：{prompt.tools.join("、")}</p>
            {Object.entries(prompt.sections).map(([key, text]) => (
              <ActivityDetails key={key} label={key} status="">
                <pre className="detail-prompt">{text}</pre>
              </ActivityDetails>
            ))}
            <ActivityDetails label="完整提示词" status="">
              <pre className="detail-prompt">{prompt.text}</pre>
            </ActivityDetails>
          </>
        ) : (
          <p>尚无提示词请求记录。先与此Bot对话。</p>
        ))}
    </div>
  );
}
