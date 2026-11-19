import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { useEffect, useState } from "react";
import { useReadState } from "../read-state.ts";
import { userError } from "../user-error.ts";
import { quotaStore } from "./quota-state.ts";

const labels = {
  ready: "账号额度",
  unsupported: "不支持读取额度",
  "signed-out": "尚未登录",
  empty: "原生服务未返回额度",
  failed: "额度读取失败",
};
export function QuotaPanel({ botId }: { botId: number }) {
  const store = quotaStore(botId);
  const { data, error, loading } = useReadState(store);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(timer);
      store.invalidate();
    };
  }, [store]);
  useEffect(() => {
    const next = data?.windows
      .map((window) => window.resetsAt)
      .filter((value): value is number => value !== null && value > Date.now())
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = setTimeout(
      () => {
        void store.load(true).catch(() => {});
      },
      Math.min(next - Date.now() + 100, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [data, store]);
  return (
    <section className="usage-quota" aria-label="订阅额度" aria-busy={loading}>
      <header className="usage-section-head">
        <h2>订阅额度</h2>
        <Button
          size="small"
          variant="secondary"
          pending={loading}
          onClick={() => {
            void store.load(true).catch(() => {});
          }}
        >
          刷新额度
        </Button>
      </header>
      {!data && loading ? <Loading label="正在读取额度" /> : null}
      {error ? (
        <InlineNotice>
          {userError(error, "额度读取失败。")}
          {data ? " 保留上次读数。" : ""}
        </InlineNotice>
      ) : null}
      {data ? (
        <>
          <p className="usage-muted">
            {labels[data.status]} · {data.source}
          </p>
          {data.message ? (
            <InlineNotice>
              {data.message}
              {data.windows.length ? " 以下保留上次读数。" : ""}
            </InlineNotice>
          ) : null}
          <div className="usage-quota-windows">
            {data.windows.map((window) => (
              <div key={window.id} className="usage-quota-window">
                <div>
                  <span>{window.name}</span>
                  <strong>剩余 {(100 - window.usedPercent).toFixed(1)}%</strong>
                </div>
                <progress
                  aria-label={`${window.name}剩余额度`}
                  value={100 - window.usedPercent}
                  max={100}
                />
                <small>
                  {window.resetsAt === null
                    ? "重置时间未提供"
                    : window.resetsAt <= now
                      ? "已到重置时间，等待原生读数"
                      : `${Math.ceil((window.resetsAt - now) / 60_000)} 分钟后重置 · ${new Date(window.resetsAt).toLocaleString()}`}
                </small>
              </div>
            ))}
          </div>
          {data.credits ? (
            <p>
              积分：
              {data.credits.unlimited
                ? "不限量"
                : (data.credits.balance ??
                  (data.credits.available
                    ? "可用，余额未提供"
                    : "原生服务报告不可用"))}
            </p>
          ) : null}
          <p className="usage-note">
            账号范围读数，多个 Bot 可能共用。更新于{" "}
            {new Date(data.observedAt).toLocaleString()}
            。本地费用估算不用于推算余额。
          </p>
        </>
      ) : null}
    </section>
  );
}
