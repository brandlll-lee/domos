import { Button } from "@domos/ui/controls";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { PanelCard } from "@domos/ui/panel";
import { Popover } from "@domos/ui/popover";
import { Progress } from "@domos/ui/progress";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { useEffect, useState } from "react";
import { EngineMark } from "../bots/engine-mark.tsx";
import { useReadState } from "../read-state.ts";
import { userError } from "../user-error.ts";
import { quotaGroups, quotaReset } from "./data.ts";
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
  const timed = data?.windows.some((window) => window.resetsAt !== null);
  useEffect(() => {
    if (!timed) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      if (!document.hidden) {
        setNow(Date.now());
        timer = setInterval(() => setNow(Date.now()), 30_000);
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [timed]);
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
  const label =
    data?.accountLabel === "当前登录账号"
      ? undefined
      : data?.accountLabel?.replace(/^(.{1,2})[^@]*(@.*)$/, "$1•••$2");
  const identity = [label, data?.plan].filter(Boolean).join(" · ");
  return (
    <PanelCard
      role="article"
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
            {identity && <small>{identity}</small>}
          </div>
        </div>
        <div className="usage-section-actions">
          {data && (
            <Popover.Root>
              <Popover.Trigger
                render={
                  <Button
                    size="icon-small"
                    variant="ghost"
                    aria-label={`${name} 额度详情`}
                  />
                }
              >
                <InfoIcon />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner
                  className="usage-quota-positioner"
                  side="bottom"
                  align="end"
                  sideOffset={8}
                  collisionPadding={12}
                >
                  <Popover.Popup className="popover-surface usage-quota-info">
                    <Popover.Title>{name} 额度详情</Popover.Title>
                    {data.message && <p>{data.message}</p>}
                    <p>{data.source}</p>
                    <p>{new Date(data.observedAt).toLocaleString()} 更新</p>
                    {data.windows.map((window) => (
                      <p key={window.id}>
                        {window.name}
                        {window.resetsAt !== null && (
                          <>
                            {" "}
                            · {new Date(window.resetsAt).toLocaleString()} 重置
                          </>
                        )}
                      </p>
                    ))}
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          )}
          <Button
            size="icon-small"
            variant="ghost"
            aria-label={`刷新 ${name} 额度`}
            pending={loading}
            onClick={() => {
              void store.load(true).catch(() => {});
            }}
          >
            <ArrowClockwiseIcon />
          </Button>
        </div>
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
              {data.message ?? labels[data.status]}
            </p>
          )}
          {readable && data.status === "failed" && (
            <InlineNotice>读取失败，保留上次读数。</InlineNotice>
          )}
          {quotaGroups(data.windows).map((group) => (
            <div className="usage-quota-windows" key={group.name}>
              {group.name && <h4>{group.name}</h4>}
              {group.rows.map(({ window, label }) => (
                <div className="usage-quota-window" key={window.id}>
                  <div className="usage-quota-values">
                    <span>{label}</span>
                    <strong>
                      剩余 {(100 - window.usedPercent).toFixed(1)}%
                    </strong>
                  </div>
                  <Progress
                    value={100 - window.usedPercent}
                    label={`${name} ${window.name}剩余额度`}
                    tone="positive"
                  />
                  <small>{quotaReset(window.resetsAt, now)}</small>
                </div>
              ))}
            </div>
          ))}
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
        </>
      )}
    </PanelCard>
  );
}

export function QuotaPanel() {
  const { data: providers, error, loading } = useReadState(quotaCatalog);
  return (
    <section className="usage-quota" aria-label="订阅额度">
      <header className="usage-quota-toolbar">
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
      {Boolean(error) && (
        <InlineNotice>{userError(error, "引擎目录读取失败。")}</InlineNotice>
      )}
      <div className="usage-quota-grid">
        {providers?.map((provider) => (
          <AccountQuota
            key={provider.id}
            provider={provider.id}
            name={provider.name}
          />
        ))}
      </div>
    </section>
  );
}
