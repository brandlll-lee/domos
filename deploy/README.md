# 自托管与工作电脑

Domos 服务保存会话、模型凭据和附件。工作电脑执行 Bot 命令并保存工作文件。多个 Bot 共享实例的工作电脑。Bot 子目录用于组织文件。

## 桌面

选择“在这台电脑上托管”或“连接已有 Domos”。本机托管需要 Docker Engine 或 Docker Desktop 的 Linux 容器模式。安装器检查环境，准备镜像，生成配置，并启动后台和控制端。失败后可以重试。已有配置会保留。

首次管理员配对完成后，在网页连接模型。凭据通过 Pi 管理，并加密保存于服务端。桌面保存各实例地址，各实例使用独立浏览器会话。

```sh
pnpm install --frozen-lockfile
pnpm --filter @domos/desktop dist --win --config.win.signAndEditExecutable=false
```

测试包位于 `apps/desktop/release`。开发包尚未签名。公开发行前需要签名凭据。macOS 和 Linux 打包配置已提供，但仍须分别验收。

## 服务器

```sh
sh deploy/install.sh
```

脚本准备镜像、Compose 和初始配置。应用默认发布到 `127.0.0.1:4310`。应用以非 root 运行。受信控制端独占 Docker socket。Bot 工作容器不挂载控制凭据、模型密钥、服务数据或 Docker socket。

镜像和入口由 `deploy/release.json` 管理。配置保存在 `control-data` 卷。会话、凭据和附件保存在 `app-data` 卷。工作文件使用独立 Docker 卷。

原生服务安装：

```sh
pnpm build
pnpm host install --directory /srv/domos
pnpm host start --directory /srv/domos
```

`data/owner-code` 保存首次管理员码。失效后可运行 `pnpm host pair --directory /srv/domos` 刷新。已有管理员应在“管理实例”生成设备配对码。

## 远程连接

连接已有实例的客户端无需 Docker。管理员从“管理实例 → 设备”生成一次性码。新设备输入地址及配对码。权限分为使用 Bot 和管理实例。撤销设备会终止其订阅，并拒绝后续请求。

其他设备通过 HTTPS 访问服务。将 `publicUrl` 或 `DOMOS_PUBLIC_URL` 设为实际 HTTPS 源。使用独立域名源，不使用路径前缀。宿主机可使用 `deploy/Caddyfile`，配置 `DOMOS_DOMAIN`。域名、证书和网络入口由部署环境提供。不要公开控制端。

配置优先级为环境覆盖、配置文件、默认值。相对路径按配置文件位置解析。支持 `DOMOS_CONFIG`、`DOMOS_HOST`、`DOMOS_PORT`、`DOMOS_DATA_DIR`、`DOMOS_STATIC_DIR`、`DOMOS_DEPLOYMENT`、`DOMOS_PUBLIC_URL`。配置文件不保存模型密钥。

## 执行环境

| computer.kind | 实际执行位置 |
| --- | --- |
| process | 当前服务环境，使用服务用户权限 |
| docker | 本地或 SSH 主机上的独立 Linux 工作容器 |
| controller | 由受信控制端管理的独立 Linux 工作容器 |

标准安装使用控制端。直接访问服务环境须显式配置 `process`。应用容器内的 `process` 与服务共享权限。

工作容器使用 UID 1000、只读根目录、移除额外能力、禁止提权，以及 CPU、内存和进程限制。命令、上传、读写、图片处理和成果发布使用同一执行环境。已发布成果使用服务端快照。

SSH 配置参考 `domos.config.example.json`。必须提供已核验的 `knownHostsFile` 和 `hostKeyAlias`。SSH 用户需要 Docker 权限。私钥仅供受信控制端使用。

当前后端实现为 Docker。`sbx` 和 SPACE 尚未接入，不显示为可用选项。工作电脑接口与部署入口独立。

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

桌面维护入口先停止托管，再备份配置、会话、凭据、附件和工作文件。备份使用认证加密。密码至少 12 个字符。请单独保存密码。恢复使用新目录和新工作卷。

```sh
pnpm host backup --directory /srv/domos --file /backup/domos.domos --password-file /secure/backup-password
pnpm host restore --directory /srv/domos-restored --file /backup/domos.domos --password-file /secure/backup-password
```

原生备份要求服务停止。Compose 安装须停写后备份 `app-data`、`control-data` 和工作卷。原生备份命令不支持 Compose 分卷布局。

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

容器套件覆盖文件任务、恢复、共享与隔离、网络、超时、取消和 Pi 环境一致性。Linux CI 包含本地 Docker 和 SSH 测试。Windows Docker Desktop 和真实远程主机仍须实机验收。跳过测试不代表通过验收。
