# Domos

Domos 是一个拥有电脑的常驻个人 AI 伙伴。

当前工程支持 DeepSeek 流式聊天与持久会话。

## 聊天

在根目录 `.env` 中填写 `DEEPSEEK_API_KEY`。
也可以通过系统环境变量提供密钥。
密钥只由 Node 和模型 SDK 在运行时加载。

```sh
pnpm chat
pnpm chat "你好"
```

模型为 DeepSeek V4.1 Flash，API 名称为 `deepseek-flash`。
会话保存在 `data/agent.sqlite`，重启后继续使用。
交互模式会显示历史消息。Ctrl+C 保存并退出，未完成的回复会在下次启动时恢复。
请从项目根目录启动，并且只运行一个聊天进程。

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
```

测试使用真实 SQLite、官方测试模型和模拟接口响应。
测试会启动独立进程，并在指定执行阶段强制结束该进程。
运行测试不需要模型密钥，也不调用付费服务。

## 结构

- `packages/agent/src/open-agent.ts`：打开持久 Agent，恢复同一个会话。
- `apps/cli/src/`：组装模型、启动终端聊天、显示回复。
- `packages/agent/test/`：验证存储、提交、观察、停止和进程恢复。
- `references/`：三个参考项目。Git 忽略该目录。

一个进程独占一份 Agent 存储。
调用方负责在进程关闭时调用 `harness.close(context)`。
