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
        读取最近一次已准备请求的提示词记录。新设置在下次模型请求生效。此处可能含有私人记忆，请谨慎分享。
      </p>
      <Button
        variant="secondary"
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
              <details key={key}>
                <summary>{key}</summary>
                <pre className="detail-prompt">{text}</pre>
              </details>
            ))}
            <details>
              <summary>完整提示词</summary>
              <pre className="detail-prompt">{prompt.text}</pre>
            </details>
          </>
        ) : (
          <p>尚无提示词请求记录。先与此Bot对话。</p>
        ))}
    </div>
  );
}
