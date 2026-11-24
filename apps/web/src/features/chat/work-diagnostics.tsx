import type { EngineRun } from "@domos/agent/harness/types";
import { Button } from "@domos/ui/controls";
import { useState } from "react";

export function WorkDiagnostics({ run }: { run?: EngineRun }) {
  const [notice, setNotice] = useState("");
  const evidence = run?.evidence;
  const usage = evidence
    ? {
        pending: "入账结果待确认",
        missing: "未收到用量",
        recorded: "已入账",
        failed: "入账失败，执行结果保留",
      }[evidence.usage]
    : "未知";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            provider: run?.provider,
            model: run?.model,
            turnId: run?.turnId,
            nativeTurnId: run?.nativeId,
            sessionId: run?.sessionId,
            status: run?.status,
            startedAt: run?.startedAt,
            endedAt: run?.endedAt,
            taskId: evidence?.taskId,
            nativeSessionId: evidence?.nativeSessionId,
            version: evidence?.version,
            usage: evidence?.usage,
            counters: evidence?.counters,
            toolCalls: evidence?.toolCalls,
            missingResults: evidence?.missingResults,
            errorCode: evidence?.errorCode,
            coverage: "received-native-events",
          },
          null,
          2,
        ),
      );
      setNotice("已复制，不含聊天正文和工具参数");
    } catch {
      setNotice("复制失败，请允许剪贴板访问");
    }
  };
  return (
    <>
      <dl>
        <dt>任务</dt>
        <dd>{evidence?.taskId ?? "历史记录未保存"}</dd>
        <dt>引擎</dt>
        <dd>
          {run?.provider ?? "未知"} · {evidence?.version ?? "版本未知"}
        </dd>
        <dt>原生会话</dt>
        <dd>{evidence?.nativeSessionId ?? "未知"}</dd>
        <dt>用量</dt>
        <dd>{usage}</dd>
        <dt>工具结果缺口</dt>
        <dd>
          {evidence?.missingResults === undefined
            ? "未知"
            : `${evidence.missingResults} / ${evidence.toolCalls}`}
        </dd>
        {evidence?.errorCode !== undefined && (
          <>
            <dt>错误码</dt>
            <dd>{evidence.errorCode}</dd>
          </>
        )}
      </dl>
      <p>范围：已接收的原生事件。时间线使用接收时间，原生时间缺失时不推算。</p>
      <Button variant="secondary" onClick={() => void copy()}>
        复制诊断信息
      </Button>
      {notice && <p role="status">{notice}</p>}
    </>
  );
}
