import { Button } from "@domos/ui/controls";
import { Disclosure } from "@domos/ui/disclosure";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { useEffect, useState } from "react";
import { EngineMark } from "../bots/engine-mark.tsx";
import { useReadState } from "../read-state.ts";
import { userError } from "../user-error.ts";
import { quotaCatalog, quotaStore } from "./quota-state.ts";

const labels = {
  ready: "账号额度",
  unsupported: "未提供订阅额度",
  "signed-out": "尚未登录",
  "not-installed": "未安装",
  empty: "未返回额度",
  failed: "读取失败",
};

function AccountQuota({ provider, name }: { provider: string; name: string }) {
  const store = quotaStore(provider);
  const { data, error, loading } = useReadState(store);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
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
  const readable = Boolean(data?.windows.length || data?.credits);
  const label = data?.accountLabel?.replace(/^(.{1,2})[^@]*(@.*)$/, "$1•••$2");
  return (
    <article
      className="usage-quota-account"
      data-readable={readable || undefined}
      aria-label={name}
      aria-busy={loading}
    >
      <header className="usage-section-head">
        <div className="usage-quota-identity">
          <EngineMark provider={provider} />
          <div>
            <h3>{name}</h3>
            {readable && (
              <small>
                {label ?? "当前登录账号"}
                {data?.plan ? ` · ${data.plan}` : ""}
              </small>
            )}
          </div>
        </div>
        <Button
          size="small"
          variant="ghost"
          pending={loading}
          onClick={() => {
            void store.load(true).catch(() => {});
          }}
        >
          刷新
        </Button>
      </header>
      {!data && loading && <Loading label="正在读取额度" inline />}
      {Boolean(error) && (
        <InlineNotice>
          {userError(error, "额度读取失败。")}
          {readable ? " 保留上次读数。" : ""}
        </InlineNotice>
      )}
      {data && (
        <>
          {!readable && (
            <p className="usage-muted" role="status">
              {data.status === "unsupported" && data.message
                ? data.message
                : labels[data.status]}
            </p>
          )}
          {readable && data.status === "failed" && (
            <InlineNotice>读取失败，保留上次读数。</InlineNotice>
          )}
          <div className="usage-quota-windows">
            {data.windows.map((window) => (
              <div className="usage-quota-window" key={window.id}>
                <div>
                  <span>{window.name}</span>
                  <strong>剩余 {(100 - window.usedPercent).toFixed(1)}%</strong>
                </div>
                <progress
                  aria-label={`${name} ${window.name}剩余额度`}
                  value={100 - window.usedPercent}
                  max={100}
                />
                <small>
                  {window.resetsAt === null
                    ? "重置时间未提供"
                    : window.resetsAt <= now
                      ? "等待重置后读数"
                      : `${Math.ceil((window.resetsAt - now) / 60_000)} 分钟后重置`}
                </small>
              </div>
            ))}
          </div>
          {data.credits && (
            <p className="usage-quota-credit">
              积分{" "}
              <strong>
                {data.credits.unlimited
                  ? "不限量"
                  : (data.credits.balance ??
                    (data.credits.available ? "可用，余额未提供" : "不可用"))}
              </strong>
            </p>
          )}
          <Disclosure label="来源与详情">
            <div className="usage-note">
              {data.message && <p>{data.message}</p>}
              <p>
                {data.source} · {new Date(data.observedAt).toLocaleString()}
              </p>
              {data.windows.map(
                (window) =>
                  window.resetsAt !== null && (
                    <p key={window.id}>
                      {window.name} ·{" "}
                      {new Date(window.resetsAt).toLocaleString()} 重置
                    </p>
                  ),
              )}
            </div>
          </Disclosure>
        </>
      )}
    </article>
  );
}

export function QuotaPanel() {
  const { data: providers, error, loading } = useReadState(quotaCatalog);
  const [, update] = useState(0);
  useEffect(() => {
    const stores = providers?.map((provider) => quotaStore(provider.id)) ?? [];
    const subscriptions = stores.map((store) =>
      store.subscribe(() => update((value) => value + 1)),
    );
    for (const store of stores) void store.load().catch(() => {});
    return () => {
      for (const unsubscribe of subscriptions) unsubscribe();
    };
  }, [providers]);
  const accounts =
    providers?.filter((provider) => {
      const data = quotaStore(provider.id).snapshot().data;
      return Boolean(data?.windows.length || data?.credits);
    }) ?? [];
  const others =
    providers?.filter((provider) => !accounts.includes(provider)) ?? [];
  const reading = providers?.some(
    (provider) => quotaStore(provider.id).snapshot().loading,
  );
  return (
    <section className="usage-quota" aria-label="订阅额度">
      <header className="usage-section-head">
        <p className="usage-muted">当前电脑 · 已登录账号的额度</p>
        <Button
          size="small"
          variant="ghost"
          onClick={() => {
            if (providers)
              for (const provider of providers)
                void quotaStore(provider.id)
                  .load(true)
                  .catch(() => {});
            else void quotaCatalog.load(true).catch(() => {});
          }}
        >
          刷新全部
        </Button>
      </header>
      {loading && !providers && <Loading label="正在读取引擎" />}
      {reading && <Loading label="正在更新账号额度" inline />}
      {Boolean(error) && (
        <InlineNotice>{userError(error, "引擎目录读取失败。")}</InlineNotice>
      )}
      <div className="usage-quota-grid">
        {accounts.map((provider) => (
          <AccountQuota
            key={provider.id}
            provider={provider.id}
            name={provider.name}
          />
        ))}
      </div>
      {!reading && providers && !accounts.length && (
        <p className="usage-muted">当前尚无可显示的额度。</p>
      )}
      {others.length > 0 && (
        <Disclosure label={`其他状态 · ${others.length} 个引擎`}>
          <div className="usage-quota-grid usage-quota-other">
            {others.map((provider) => (
              <AccountQuota
                key={provider.id}
                provider={provider.id}
                name={provider.name}
              />
            ))}
          </div>
        </Disclosure>
      )}
    </section>
  );
}
