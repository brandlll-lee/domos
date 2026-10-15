# Domos

Domos 是一个拥有电脑的常驻个人 AI 伙伴。

当前工程支持 DeepSeek 流式聊天与持久会话。

## 聊天

在根目录 `.env` 中填写 `DEEPSEEK_API_KEY`。
也可以通过系统环境变量提供密钥。
密钥只由 Node 和模型 SDK 在运行时加载。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

打开 `http://127.0.0.1:4310`。
网页支持流式回复、查看历史和停止生成。
刷新或关闭网页不会停止后台任务。
重开页面会恢复当前会话；后台重启后会继续未完成的回复。
当前服务仅监听本机。

终端聊天：

```sh
pnpm chat
pnpm chat "你好"
```

模型为 DeepSeek V4.1 Flash，API 名称为 `deepseek-flash`。
会话保存在 `data/agent.sqlite`，重启后继续使用。
交互模式会显示历史消息。Ctrl+C 保存并退出，未完成的回复会在下次启动时恢复。
请从项目根目录启动。网页后台与终端入口共用会话，选择其中一个运行。

## 开发

使用 Node.js 24 和 pnpm 10.20.0。

本机尚未安装 Node.js 24 时，可以直接运行：

```sh
npx --yes --package=node@24.22.0 --package=pnpm@10.20.0 pnpm chat
```

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright install chromium --only-shell
pnpm test:e2e
```

开发页面时，在两个终端分别运行 `pnpm start` 与 `pnpm web`。
打开 Vite 输出的地址。页面请求会转发到本机后台。

测试使用真实 SQLite、官方测试模型和模拟接口响应。
测试会启动独立进程，并在指定执行阶段强制结束该进程。
运行测试不需要模型密钥，也不调用付费服务。

## 结构

- `packages/agent/src/open-agent.ts`：打开持久 Agent，恢复同一个会话。
- `packages/agent/src/open-chat.ts`：配置真实模型，供各入口共用。
- `packages/agent/src/chat-view.ts`：提取可供界面显示的会话状态。
- `apps/api/src/`：提供会话接口和网页服务。
- `apps/web/src/`：聊天页面与连接管理。
- `apps/cli/src/`：终端聊天入口。
- `packages/agent/test/`：验证存储、提交、观察、停止和进程恢复。
- `references/`：三个参考项目。Git 忽略该目录。

一个进程独占一份 Agent 存储。
调用方负责在进程关闭时调用 `harness.close(context)`。
