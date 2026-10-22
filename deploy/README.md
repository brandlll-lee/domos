# 自托管与工作电脑

Domos 服务保存会话、模型凭据和附件。工作电脑执行 Bot 命令并保存工作文件。每个 Bot 可以使用服务所在环境、共用隔离电脑或独立隔离电脑。

## 桌面

首次打开，选择“在这台电脑运行”或“连接已有 Domos”。选择这台电脑后，再选择“直接运行”或“在 Docker 中运行”。

直接运行使用应用内的后台，不需要 Docker。Docker 方式需要已启动的 Linux Docker 引擎和 Compose。确认后才准备镜像、启动服务并等待就绪。失败可以重试或更换方式。应用不会自动安装 Docker 或启动 WSL。

两种本机方式分别保存数据。切换不迁移聊天和工作文件。桌面 Docker 服务使用独立的 Compose 项目与回环端口。服务数据保存在应用管理的目录中。受信控制端持有 Docker socket，应用与 Bot 工作容器均不持有。

本机桌面自动完成配对。随后设置 Bot 身份、选择工作电脑，再选择任务引擎并连接账号。已有服务使用配对码连接。服务端凭据加密保存。各服务使用独立浏览器会话。再次启动会恢复所选方式。

```sh
pnpm install --frozen-lockfile
pnpm --filter @domos/desktop dist --win --config.win.signAndEditExecutable=false
```

测试包位于 `apps/desktop/release`。开发包尚未签名。公开发行前需要签名凭据。macOS 和 Linux 打包配置已提供，但仍须分别验收。

## 服务器

```sh
sh deploy/install.sh
```

脚本准备镜像、Compose 和初始配置。应用默认发布到 `127.0.0.1:4310`。应用以非 root 运行。受信控制端独占 Docker socket。Bot 工作容器不挂载控制凭据、服务数据库或 Docker socket。任务引擎只取得所选账号的凭据。

镜像和入口由 `deploy/release.json` 管理。配置保存在 `control-data` 卷。会话、凭据和附件保存在 `app-data` 卷。工作文件使用独立 Docker 卷。

直接运行原生服务，不需要 Docker：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

需要控制端与预设工作容器时，使用以下托管命令。这种安装需要 Docker：

```sh
pnpm build
pnpm host install --directory /srv/domos
pnpm host start --directory /srv/domos
```

`data/owner-code` 保存首次管理员码。托管目录的配对码失效后，可运行 `pnpm host pair --directory /srv/domos` 刷新。已有管理员从“设置 → 通用 → 在其他设备上使用”生成设备配对码。

## 远程连接

连接已有服务的客户端无需 Docker。管理员从“设置 → 通用 → 在其他设备上使用”生成一次性码。新设备输入地址及配对码。权限分为使用 Bot 和管理服务。撤销设备会终止其订阅，并拒绝后续请求。

其他设备通过 HTTPS 访问服务。将 `publicUrl` 或 `DOMOS_PUBLIC_URL` 设为实际 HTTPS 源。使用独立域名源，不使用路径前缀。宿主机可使用 `deploy/Caddyfile`，配置 `DOMOS_DOMAIN`。域名、证书和网络入口由部署环境提供。不要公开控制端。

配置优先级为环境覆盖、配置文件、默认值。相对路径按配置文件位置解析。支持 `DOMOS_CONFIG`、`DOMOS_HOST`、`DOMOS_PORT`、`DOMOS_DATA_DIR`、`DOMOS_STATIC_DIR`、`DOMOS_DEPLOYMENT`、`DOMOS_PUBLIC_URL`。配置文件不保存模型密钥。

## 执行环境

| computer.kind | 实际执行位置 |
| --- | --- |
| process | 当前服务环境，使用服务用户权限 |
| docker | 本地或 SSH 主机上的独立 Linux 工作容器 |
| controller | 由受信控制端管理的独立 Linux 工作容器 |

服务通过 `deployment` 声明原生或容器部署。`workComputer` 声明可准备的隔离电脑模板。它可以使用 Docker 驱动或控制端。Bot 选择环境后才准备并绑定，不会改变其他 Bot 的选择。应用容器内的 `process` 与服务共享权限。连接远端服务时，`process` 指远端服务环境。

共享电脑复用同一个工作容器。独立电脑按 Bot 分别创建容器和持久卷。切换环境不复制工作文件。电脑停止后，下一次工具访问会尝试恢复。准备失败保留原有绑定，不会自动改用服务环境。

工作容器使用 UID 1000、只读根目录、移除额外能力、禁止提权，以及 CPU、内存和进程限制。命令、上传、读写、图片处理和成果发布使用同一执行环境。已发布成果使用服务端快照。

SSH 配置参考 `domos.config.example.json`。必须提供已核验的 `knownHostsFile` 和 `hostKeyAlias`。SSH 用户需要 Docker 权限。私钥仅供受信控制端使用。

隔离电脑使用 Docker。工作电脑接口与服务部署入口独立。

## 任务引擎

每个 Bot 分别选择 Pi、Codex、Claude Code 或 OpenCode。原生引擎运行在它绑定的工作电脑中。服务通过标准输入输出管理会话、任务与审批。记忆、技能、定时任务、消息与附件使用现有产品工具，通过仅绑定工作电脑回环地址的 MCP 网关调用。网关只在引擎运行时开放。

Pi 使用内置的 Coding Agent。其他引擎只在管理员点击安装后下载。它们安装在工作电脑的 `engines/runtime` 目录；Docker 工作电脑使用 `/home/domos/.domos/engines/runtime`。原生工作电脑需要 Node.js 24+ 和 npm。系统已有的 CLI 也可使用。命令和文件操作使用该电脑的系统权限。

账号来源默认为“Domos 管理”。Codex 和 Claude Code 可从界面完成官方登录。各引擎也可使用实际支持的 API 密钥连接。OpenCode 从引擎读取服务商与认证方式。Pi 可同时保留多个服务商。托管账号保存在工作电脑的引擎数据目录，并按 CLI 格式保存。

选择“工作电脑已有配置”后，四家引擎读取执行电脑运行用户的原生账号与模型。原生账号在原 CLI 中管理。Pi 使用内置运行库，Bot 会话单独保存。容器和系统服务使用其运行用户的配置。客户端登录不会自动传入远端。服务中的账号密钥不出现在日志中。同一工作电脑上的 Bot 共用所选来源的账号目录和系统权限。

引擎空闲时关闭进程，原生会话文件保留。更换引擎或工作电脑会新建会话，并带上近期聊天。旧聊天保留在服务中。Pi Durable 保存外层排队、请求和产品工具结果。它不接管原生循环，也不保证重做任意原生工具。重启时核对四种引擎的原生历史。能够证明完成的轮次会补齐结果。其他不确定任务显示“执行结果未确认”。先核对文件与外部操作，再决定是否重试。

新建隔离电脑默认使用 `domos-workspace:3`。此镜像含 Chromium、X11 桌面和电脑驱动。旧电脑先停止任务并备份，再用原有镜像标签重新构建 `deploy/workspace.Dockerfile`，最后在电脑高级管理中重建容器。工作卷保留。重建不会恢复旧的运行进程。此升级不会自动执行。

## 浏览器与桌面

在 Bot 的“电脑”面板中，分别启用浏览器和桌面服务。先运行检查，再开始任务。原生工作电脑须有已登录的图形会话及屏幕权限。浏览器缺少 Chromium 时，可由管理员确认下载。隔离电脑使用镜像内的 Chromium。浏览器资料按工作电脑与 Bot 保存。

点击“观看浏览器”或“观看桌面”查看画面。点击“接管”后才可输入。接管期间，Agent 的对应操作会被阻止。密码、验证码、支付等步骤由用户完成。点击“交还控制权”后，Agent 须重新观察。关闭观看窗口也会交还控制权。共享桌面同一时间只允许一个操作者。

浏览器画面使用确认帧传输。桌面目前使用确认后采集的截图流，刷新间隔至少 500 毫秒。它支持基本观看和接管，不提供高帧率远程视频。断线后可重新连接。停止任务会取消所属调用；结果不明的操作须先核对，再决定是否重试。

截图沿用附件预览和下载流程。证据保存采集时间、工具、任务与调用标识。网页截图也保留来源网址。工具向引擎传递实际图片。明确不支持图片的模型会收到能力提示。

## 网络

`none` 关闭外部网络。

`web` 使用隔离内部网桥和 Squid HTTP(S) 代理。代理只允许 80、443 端口，并拒绝私有地址和其他特殊地址。工作容器不能直接路由到外部。需要支持 isolated 网桥的 Docker Engine。Docker Desktop 的实际网络行为仍须实机验收。此模式不提供任意协议的公网访问。

`restricted` 使用 Linux Docker Engine 的主机防火墙规则：

```sh
sudo bash deploy/restrict-computer-egress.sh
sudo /usr/local/sbin/domos-computer-egress --check
```

控制用户需要该检查命令的精确 sudo 权限。此模式不适用于 Docker Desktop、rootless 或原生 nftables。启动和连接会核验网络、权限和挂载。核验失败则拒绝连接。

## 备份与更新

桌面维护入口先停止托管，再备份配置、会话、凭据、附件和工作文件。Domos 管理的引擎账号及会话随服务数据目录或工作卷一并保存。工作电脑的已有 CLI 配置须单独备份。备份使用认证加密。密码至少 12 个字符。请单独保存密码。恢复使用新目录和新工作卷。

```sh
pnpm host backup --directory /srv/domos --file /backup/domos.domos --password-file /secure/backup-password
pnpm host restore --directory /srv/domos-restored --file /backup/domos.domos --password-file /secure/backup-password
```

备份前须停止服务。桌面托管的两种运行方式均使用“数据与备份”。服务器 Compose 安装须停写后备份 `app-data`、`control-data` 和工作卷。桌面备份命令不支持服务器 Compose 分卷布局。

更新前停止任务并备份。安装新版本后，检查实例和工作电脑状态。失败时恢复原程序及匹配的数据备份。当前采用手动安装更新。卸载默认保留数据。普通升级不要执行 `docker compose down -v`。

一份数据目录只允许一个实例接管。磁盘须支持 SQLite 文件锁，不使用 NFS。容器重建不会恢复原 exec 进程。连接中断后，先核对命令结果，再决定是否重试。

## 验收

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm --filter @domos/desktop build
pnpm exec playwright test --config apps/desktop/playwright.config.ts
node --test apps/desktop/test/package.test.mjs
```

分发包测试须先构建 Windows 包。它校验依赖位于包内，并启动包内后台。

Docker 主机先构建工作镜像及代理镜像，再运行：

```sh
DOMOS_CONTAINER_TESTS=1 pnpm exec vitest run packages/agent/test/container.test.ts
```

托管服务测试还须先执行 `docker build -f deploy/Dockerfile -t domos-app:test .`，再运行：

```sh
DOMOS_CONTAINER_TESTS=1 pnpm exec vitest run apps/api/test/stack-container.test.ts
```

该测试验证服务容器、混合 Bot 环境、重启和备份恢复。

容器套件覆盖文件任务、恢复、共享与隔离、网络、超时、取消和 Pi 环境一致性。Linux CI 包含本地 Docker 和 SSH 测试。Windows Docker Desktop 和真实远程主机仍须实机验收。跳过测试不代表通过验收。
