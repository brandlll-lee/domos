<p align="center"><img src="packages/ui/assets/icon.png" width="88" alt="Domos" /></p>

# Domos

让一支 AI 团队，常驻你的电脑。

Domos 是你可以自己部署的开源 AI 团队。每位伙伴都有自己的职责、记忆和工作环境，能使用工具、处理文件，并按你的计划执行任务。交代好工作，它们就能在后台继续。你回来时，接着上次的进度往下做。

运行在你自己的电脑或服务器上。只要 Domos 保持运行，你的团队就能全天候待命。

[English](README.md) · **简体中文**

## 可以做什么

- 创建多个 Bot，分别设置名字、职责、模型和对话。
- 保存聊天、记忆、技能和定时任务，重启后继续使用。
- 上传文件、执行命令、下载处理结果。
- 为不同 Bot 选择共用或独立的工作环境。
- 用配对码连接其他设备，随时撤销访问权限。

Domos 使用 Pi 和 Pi Durable 连接模型并保存 Agent 的工作状态。
目前的电脑工具支持命令与文件操作，暂不提供图形桌面控制。

## 开始使用

从源码运行，需要 **Node.js 24+** 和 **pnpm 10.20.0**。在项目目录执行：

```sh
pnpm install --frozen-lockfile
pnpm desktop
```

桌面应用会引导你完成以下步骤：

1. **选择在哪里运行。** 使用这台电脑，或填写已有 Domos 的地址。
2. **连接模型。** 在界面中登录或填写密钥，再给第一个 Bot 取个名字。
3. **选择 Bot 在哪里工作。** 确认文件和命令权限，Domos 会准备所选环境。

选择这台电脑时，**直接运行**不需要 Docker。**在 Docker 中运行**需要已启动的 Linux Docker 引擎。只有选中 Docker 相关选项并继续后，Domos 才会准备镜像。应用不会替你安装 Docker 或启动 WSL。

连接已有 Domos 时，完成设备配对即可使用原有 Bot 和聊天记录。下次打开会恢复上次的连接。

## 选择 Bot 的工作环境

Domos 在哪里运行，与 Bot 在哪里处理任务，是两个选择。

| 选项 | Bot 实际在哪里工作 |
| --- | --- |
| 使用服务所在环境 | 运行 Domos 的电脑或服务容器内 |
| 共用一台隔离电脑 | 多个 Bot 共用一个 Docker 工作容器 |
| 单独一台隔离电脑 | 此 Bot 专用的 Docker 工作容器 |

连接已有服务时，这里的电脑指**服务所在电脑**，不是你正在使用的设备。服务配置了工作环境后，才可使用隔离电脑选项。

使用服务所在环境时，Bot 拥有服务账户可用的系统权限。同一环境里的不同文件夹不构成隔离。不同服务运行方式分别保存数据，切换时不会自动搬迁聊天或工作文件。

## 在浏览器中使用

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

打开 **http://127.0.0.1:4310**。首次输入 `data/owner-code` 中的管理员码，再在界面中连接模型。无需先创建环境变量文件。

聊天和凭据保存在服务的数据目录中。凭据加密保存。一份数据目录只能由一个服务进程使用。

连接其他设备，请打开**设置 → 通用 → 在其他设备上使用**。远程访问需要 HTTPS。服务器安装、权限和备份见[部署说明](deploy/README.md)。

## 开发

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright install chromium --only-shell
pnpm test:e2e
```

开发网页时，在两个终端分别运行 `pnpm start` 和 `pnpm web`，再打开 Vite 输出的地址。终端聊天使用 `pnpm chat`。

运行 `pnpm --filter @domos/desktop dist` 构建桌面安装包。产物位于 `apps/desktop/release`。本地构建尚未签名。

| 目录 | 职责 |
| --- | --- |
| `apps/desktop` | 桌面应用与本机服务启动 |
| `apps/web` | 聊天、Bot 设置与上手引导 |
| `apps/api` | 服务接口、鉴权与文件访问 |
| `apps/controller` | 隔离电脑的启动、停止与通信 |
| `packages/agent` | 持久 Agent、工具与工作空间 |
| `packages/ui` | 共享控件、主题与品牌 |
| `packages/hosting` | 配对、凭据、服务准备与备份 |

测试使用临时数据和测试模型，常规测试无需模型密钥。真实容器测试需要 Docker，单独执行。详见[部署验收](deploy/README.md#验收)。
