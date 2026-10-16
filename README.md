# Domos

Domos 是一个拥有电脑的常驻个人 AI 伙伴。

当前工程支持模型选择、流式聊天与持久会话。

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
默认服务仅监听本机。首次访问需要管理员配对码，文件保存在 `data/owner-code`。

终端聊天：

```sh
pnpm chat
pnpm chat "你好"
```

`domos.config.json` 设置新会话的初始模型，默认是 DeepSeek V4.1 Flash。
网页的模型选项来自 SDK 中已配置凭据的模型目录。
选择会保存到当前会话，重启后保留；正在执行的请求继续使用原模型。
配置文件不存密钥。管理员可以在“管理实例”连接模型，凭据加密保存在服务端。
会话保存在 `data/agent.sqlite`，重启后继续使用。
交互模式会显示历史消息。Ctrl+C 保存并退出，未完成的回复会在下次启动时恢复。
配置与静态资源不依赖启动目录。网页后台与终端入口共用会话，选择其中一个运行。

## 部署与工作电脑

桌面端提供“在这台电脑上托管”和“连接已有 Domos”。安装器准备后台及 Linux 工作电脑。其他设备通过 HTTPS 和一次性码配对。设备可单独撤销。

同一套服务支持原生或容器部署。工具可以使用当前环境，或独立 Linux 工作沙箱。
命令、上传、文件处理和成果交付使用同一执行目标。
Bot 右侧栏的“电脑”显示目标、权限边界和运行状态。
完整配置、SSH、隔离策略、持久卷和回滚步骤见 [部署说明](deploy/README.md)。

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
`openChat()` 的调用方在进程关闭时调用 `runtime.close()`，以关闭 Agent、电脑连接并释放数据目录。
