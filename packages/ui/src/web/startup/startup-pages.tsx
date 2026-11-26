import { brandCharacter } from "@domos/ui/characters";
import { Button } from "@domos/ui/controls";
import { TextField } from "@domos/ui/field";
import { InlineNotice } from "@domos/ui/message";
import { ChoicePicker } from "@domos/ui/picker";
import { DesktopTitlebar } from "@domos/ui/titlebar";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { type ReactNode, useEffect, useRef } from "react";
import { Character } from "../character.tsx";
import { EngineMark } from "../engine-mark.tsx";
import { HarnessConstellation } from "./harness-constellation.tsx";
import { PreparingComputer } from "./preparing-computer.tsx";
import { ReadyCompanion } from "./ready-companion.tsx";
import { RemoteConnection } from "./remote-connection.tsx";
import "./startup-pages.css";

export type StartupPage =
  | "welcome"
  | "preparing"
  | "failure"
  | "access"
  | "ai"
  | "connection"
  | "model"
  | "remote"
  | "pair"
  | "ready";
export type StartupAction =
  | "start"
  | "remote"
  | "back"
  | "retry"
  | "allow"
  | "defer"
  | "connect"
  | "check"
  | "save-model"
  | "connect-remote"
  | "pair"
  | "enter";
export type StartupProvider = { id: string; name: string; status: string };
export type StartupProps = {
  page: StartupPage;
  onAction: (action: StartupAction) => void;
  computer?: string;
  bot?: string;
  status?: string;
  error?: string;
  busy?: boolean;
  providers?: StartupProvider[];
  provider?: StartupProvider;
  onProvider?: (provider: StartupProvider) => void;
  models?: { value: string; label: string }[];
  model?: string;
  onModel?: (model: string) => void;
  address?: string;
  onAddress?: (address: string) => void;
  pairingCode?: string;
  onPairingCode?: (code: string) => void;
  connectionActions?: ReactNode;
  footer?: ReactNode;
};

const headings: Record<StartupPage, [string, string]> = {
  welcome: [
    "认识你的 AI 伙伴",
    "有记忆，也有自己的工作空间。陪你聊天，帮你把事情做完。",
  ],
  preparing: ["正在准备这台电脑", "为你的伙伴准备一个可以安心工作的地方。"],
  failure: ["电脑还没有准备好", "检查下方原因，然后继续。你的选择会保留。"],
  access: [
    "让伙伴在这台电脑工作",
    "Bot、记忆和文件都属于这台电脑。你决定它可以做什么。",
  ],
  ai: ["接入你使用的 AI", "使用这台电脑上的原生 AI 服务。稍后也可以更换。"],
  connection: ["连接 AI 服务", "在原生服务中完成登录，再回来继续。"],
  model: [
    "选择第一个模型",
    "模型用于你的第一位伙伴。以后可以在伙伴设置中修改。",
  ],
  remote: ["连接另一台 Domos 电脑", "访问那台电脑上的伙伴、记忆和文件。"],
  pair: ["确认要连接的电脑", "核对电脑名称和配对码，再允许这次连接。"],
  ready: ["你的伙伴准备好了", "从一段对话开始，一起完成第一件事。"],
};

export function StartupPages(input: StartupProps) {
  const props = {
    computer: "",
    bot: "Domos",
    status: "",
    error: "",
    busy: false,
    providers: [],
    provider: { id: "", name: "待设置", status: "" },
    models: [],
    model: "",
    address: "",
    pairingCode: "",
    ...input,
  };
  const { page, onAction, busy } = props;
  const heading = useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Page navigation moves focus to the heading.
  useEffect(() => {
    heading.current?.focus();
  }, [page]);
  const [title, description] = headings[page];
  const welcome = page === "welcome";
  const step =
    page === "access"
      ? 1
      : page === "ai" || page === "connection"
        ? 2
        : page === "model"
          ? 3
          : undefined;
  const action = (value: StartupAction) => () => onAction(value);
  return (
    <div className="startup-pages" data-page={page}>
      <DesktopTitlebar />
      <nav className="startup-navigation" aria-label="入门导航">
        {!welcome && page !== "preparing" && page !== "ready" && (
          <Button
            variant="ghost"
            size="small"
            onClick={action("back")}
            disabled={busy}
          >
            <ArrowLeftIcon />
            返回
          </Button>
        )}
        {step && <span className="startup-step">设置伙伴 · {step} / 3</span>}
      </nav>
      <main className="startup-main">
        {page === "ai" && <HarnessConstellation />}
        <section className="startup-content" aria-labelledby="startup-heading">
          {page === "preparing" ? (
            <PreparingComputer />
          ) : page === "remote" || page === "pair" ? (
            <RemoteConnection />
          ) : page === "connection" || page === "model" ? (
            <RemoteConnection provider={props.provider.id} />
          ) : page === "ready" ? (
            <ReadyCompanion />
          ) : (
            <div
              className="startup-characters"
              data-group={welcome || undefined}
              aria-hidden="true"
            >
              {welcome && (
                <>
                  <span className="startup-friend">
                    <Character shape="bunny" color="#c7a0f6" state="idle" />
                  </span>
                  <span className="startup-friend">
                    <Character shape="round" color="#ffb675" state="idle" />
                  </span>
                </>
              )}
              <span className="startup-mascot">
                <Character {...brandCharacter} state="idle" />
              </span>
              {welcome && (
                <>
                  <span className="startup-friend">
                    <Character shape="triangle" color="#f69dd1" state="idle" />
                  </span>
                  <span className="startup-friend">
                    <Character shape="sprout" color="#7bc6ff" state="idle" />
                  </span>
                </>
              )}
            </div>
          )}
          <h1 id="startup-heading" ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <p className="startup-description">{description}</p>
          <div className="startup-body">
            {page === "welcome" && (
              <div className="startup-actions">
                <Button onClick={action("start")}>在这台电脑开始</Button>
                <Button variant="ghost" onClick={action("remote")}>
                  连接另一台电脑
                </Button>
              </div>
            )}
            {page === "preparing" && (
              <div className="startup-status" role="status">
                <span>{props.status}</span>
              </div>
            )}
            {page === "failure" && (
              <>
                <div role="alert">
                  <InlineNotice icon={<WarningCircleIcon />}>
                    {props.error}
                  </InlineNotice>
                </div>
                <div className="startup-actions">
                  <Button onClick={action("retry")}>重试</Button>
                </div>
              </>
            )}
            {page === "access" && (
              <>
                <dl className="startup-facts">
                  <div>
                    <dt>工作电脑</dt>
                    <dd>{props.computer}</dd>
                  </div>
                  <div>
                    <dt>工作空间</dt>
                    <dd>每位伙伴有独立的个人目录</dd>
                  </div>
                  <div>
                    <dt>工具权限</dt>
                    <dd>需要操作电脑时，按你的授权执行</dd>
                  </div>
                </dl>
                <div className="startup-actions">
                  <Button onClick={action("allow")} pending={busy}>
                    授权并继续
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={action("defer")}
                    disabled={busy}
                  >
                    稍后设置
                  </Button>
                </div>
              </>
            )}
            {page === "ai" && (
              <>
                <div className="startup-providers">
                  {props.providers.map((provider) => (
                    <Button
                      key={provider.id}
                      variant="secondary"
                      className="startup-provider"
                      onClick={() => props.onProvider?.(provider)}
                    >
                      <EngineMark provider={provider.id} />
                      <span>
                        <strong>{provider.name}</strong>
                        <small>{provider.status}</small>
                      </span>
                      <span aria-hidden="true">→</span>
                    </Button>
                  ))}
                </div>
                <Button variant="ghost" onClick={action("defer")}>
                  稍后设置 AI
                </Button>
              </>
            )}
            {page === "connection" && (
              <>
                <div className="startup-service">
                  <EngineMark provider={props.provider.id} />
                  <strong>{props.provider.name}</strong>
                  <span role="status">{props.status}</span>
                </div>
                {props.connectionActions ?? (
                  <div className="startup-actions">
                    <Button onClick={action("connect")} pending={busy}>
                      打开登录
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={action("check")}
                      disabled={busy}
                    >
                      我已登录，重新检查
                    </Button>
                  </div>
                )}
              </>
            )}
            {page === "model" && (
              <>
                <div className="startup-service">
                  <EngineMark provider={props.provider.id} />
                  <strong>{props.provider.name}</strong>
                  <span>已连接</span>
                </div>
                <div className="startup-model">
                  <span>使用模型</span>
                  <ChoicePicker
                    label="使用模型"
                    items={props.models}
                    value={props.model}
                    onValueChange={(value) => props.onModel?.(value)}
                    disabled={busy}
                  />
                </div>
                <div className="startup-actions">
                  <Button
                    onClick={action("save-model")}
                    pending={busy}
                    disabled={
                      props.models.length === 0 ||
                      (!props.model &&
                        !props.models.some((model) => model.value === ""))
                    }
                  >
                    保存并继续
                  </Button>
                </div>
              </>
            )}
            {page === "remote" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  onAction("connect-remote");
                }}
              >
                <TextField
                  label="电脑地址"
                  value={props.address}
                  onValueChange={(value) => props.onAddress?.(value)}
                  placeholder="https://domos.example.com"
                  description="填写那台电脑提供的完整访问地址。"
                  error={props.error}
                  autoComplete="url"
                  disabled={busy}
                />
                <div className="startup-actions">
                  <Button type="submit" pending={busy}>
                    连接电脑
                  </Button>
                </div>
              </form>
            )}
            {page === "pair" && (
              <>
                <dl className="startup-facts">
                  <div>
                    <dt>电脑名称</dt>
                    <dd>{props.computer}</dd>
                  </div>
                  <div>
                    <dt>访问地址</dt>
                    <dd>{props.address}</dd>
                  </div>
                  <div>
                    <dt>配对码</dt>
                    <dd className="startup-code">
                      {props.onPairingCode ? (
                        <TextField
                          label="配对码"
                          value={props.pairingCode}
                          onValueChange={props.onPairingCode}
                          autoComplete="off"
                          disabled={busy}
                          required
                        />
                      ) : (
                        props.pairingCode
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="startup-actions">
                  <Button onClick={action("pair")} pending={busy}>
                    确认配对
                  </Button>
                </div>
              </>
            )}
            {page === "ready" && (
              <>
                <dl className="startup-facts">
                  <div>
                    <dt>伙伴</dt>
                    <dd>{props.bot}</dd>
                  </div>
                  <div>
                    <dt>工作电脑</dt>
                    <dd>{props.computer}</dd>
                  </div>
                  <div>
                    <dt>AI 服务</dt>
                    <dd>{props.provider.name}</dd>
                  </div>
                  <div>
                    <dt>模型</dt>
                    <dd>
                      {props.models.find((model) => model.value === props.model)
                        ?.label ?? "待设置"}
                    </dd>
                  </div>
                </dl>
                <div className="startup-actions">
                  <Button onClick={action("enter")}>开始聊天</Button>
                </div>
              </>
            )}
            {props.error && page !== "failure" && page !== "remote" && (
              <div role="alert">
                <InlineNotice icon={<WarningCircleIcon />}>
                  {props.error}
                </InlineNotice>
              </div>
            )}
          </div>
          {props.footer}
        </section>
      </main>
    </div>
  );
}
