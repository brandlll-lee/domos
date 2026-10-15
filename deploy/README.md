# 部署与工作沙箱

服务部署、工具执行目标、持久数据分别配置。多个 Bot 共用当前实例配置的工作电脑。不同隔离环境必须使用不同的电脑 ID 和工作卷。

| 服务 | computer.kind | 工具在哪里执行 |
| --- | --- | --- |
| 原生进程 | process | 启动 Domos 的电脑，使用服务用户权限 |
| 应用容器 | process | 应用容器内，与服务共享权限 |
| 原生进程或应用容器 | docker | 独立 Linux 工作容器 |

`process` 是直接访问服务环境的显式模式。应用容器化不等于工具隔离。工作容器隔离文件、进程和权限，但仍共享 Docker 主机内核。此版本不提供多租户登录或自动分配机器。

## 配置

API 和 CLI 共用 `openChat()`。默认读取项目内 `domos.config.json`，不依赖启动目录。配置文件中的相对路径以该文件为基准。

优先级为环境覆盖、配置文件、默认值。支持 `DOMOS_CONFIG`、`DOMOS_HOST`、`DOMOS_PORT`、`DOMOS_DATA_DIR`、`DOMOS_STATIC_DIR`、`DOMOS_DEPLOYMENT`。模型密钥只由运行环境提供。配置文件不保存密钥。

原生使用继续运行 `pnpm start` 或 `pnpm chat`。默认监听 `127.0.0.1:4310`，数据保存在 `data`。一份数据目录只允许一个进程使用。SQLite 文件锁在进程退出后由系统释放。数据卷需要支持 SQLite 文件锁；不要使用 NFS。

原生服务接入本机 Docker 时，在配置中增加：

```json
{
  "model": { "provider": "deepseek", "modelId": "deepseek-flash" },
  "computer": {
    "kind": "docker",
    "id": "personal",
    "image": "domos-workspace:1.2.0",
    "volume": "domos-personal-work",
    "network": "none",
    "cpus": 2,
    "memoryMiB": 1024,
    "pids": 256,
    "timeoutSeconds": 120
  }
}
```

Docker 控制端需要访问 Docker。该权限接近主机 root 权限。Bot 的工具只连接工作容器内的 Pi daemon，不获得 Docker socket、控制端 SSH 密钥、服务数据库或模型密钥。

## 构建和启动

在工作电脑所在的 Docker 主机构建工作镜像：

```sh
docker build -f deploy/workspace.Dockerfile -t domos-workspace:1.2.0 .
```

支持 Linux amd64、arm64。官方 Pi daemon 版本与 SDK 固定为 1.2.0。镜像包含 Bash、Python、Git 和 Curl。其他工具通过修改工作镜像加入。启动不会自动拉取镜像。

在服务主机准备 `deploy/domos.config.json`，参照 `domos.config.example.json`。Compose 读取前者。文件只含配置。将模型密钥提供给现有根目录 `.env`，或通过部署平台注入服务环境。

应用容器通过 SSH 连接工作主机。准备 `deploy/ssh/id_ed25519` 与 `deploy/ssh/known_hosts`。从管理员可信渠道核对主机公钥，再写入配置的 `hostKeyAlias`。不关闭主机密钥检查。容器用户为 UID 1000；该用户必须能读取密钥。私钥权限设为 0600。

SSH 用户需要 Docker 权限。此用户和主机属于受信任控制端。`deploy/ssh` 与本地部署配置已被 Git 和镜像构建忽略。应用容器不挂 Docker socket。若使用 Docker Desktop，工作容器位于其 Linux 虚拟机内。

```sh
docker compose -f deploy/compose.yaml up --build -d
```

Compose 要求 2.24 或以上。默认仅向宿主机回环地址发布 4310。当前 API 没有公网用户鉴权，不要直接发布到公网。

应用镜像使用非 root 用户、多阶段构建、只读根目录和健康检查。可通过构建参数 `NODE_IMAGE`、`DOCKER_CLI_IMAGE`、`WORK_IMAGE` 固定部署环境批准的镜像摘要。

打开 Bot 右侧栏的“电脑”，检查真实目标，然后启动工作电脑。停止和重建要求所有 Bot 空闲。工作容器使用非 root、只读根目录、`cap-drop=ALL`、`no-new-privileges` 和配置的资源上限。工作卷持续挂载于 `/home/domos`。

## 网络

默认 `network: "none"`，只有回环接口。需要公网时使用 `restricted`。先在工作主机安装防火墙：

```sh
sudo bash deploy/restrict-computer-egress.sh
sudo /usr/local/sbin/domos-computer-egress --check
```

为受信任控制用户配置精确的免交互 sudo 权限，例如：

```text
domos-control ALL=(root) NOPASSWD: /usr/local/sbin/domos-computer-egress --check
```

脚本使用 Rakazo 的 iptables 规则。它限制 `domos-c*` 网桥访问私有地址、元数据地址、其他电脑及 Docker 主机。公网流量仍可通过。需要 Linux、rootful Docker、iptables 后端。Docker Desktop、rootless 和原生 nftables 后端不支持此模式；这些环境使用 `none`。IPv6 启用时也必须通过规则检查。

创建、连接与检查时会核验规则。检查失败就拒绝连接，不回退主机或普通网桥。系统管理员需确保其他防火墙或 Docker 重启后仍保留这些规则。外部修改容器状态后，在页面刷新状态。

## 文件、恢复与备份

命令、读写、编辑、图片读取和上传均使用同一目标。Bot 目录组织文件，不隔离同一电脑的 Bot。上传失败不返回成功附件。已交付成果保存在服务端附件快照中；工作容器停止后仍可下载。

`app-data` 保存 Pi 数据库、附件、运行锁和目标绑定。工作卷保存上传与生成文件。关闭服务不会删除卷。重建工作容器保留工作卷，但会结束进程；Docker 不恢复原来的 exec 进程。
Pi 的长命令输出保存在工作容器临时目录。文件工具可以读取它们。重建容器会清除临时文件。

断线时，命令可能已执行。界面报告未确认结果。先核对实际状态，再决定是否重试。Pi 沿用现有中断和重放规则，不把有副作用的命令声明为可安全重放。

切换电脑或从原生目录迁移到卷时，先停止服务与工作容器，备份两份存储并完成显式文件迁移。确认后移除数据目录内的 `computer.json` 绑定，再启动服务。不要删除运行中实例的 `runtime.sqlite`。

回滚时先停止服务，恢复配置或应用镜像，再恢复匹配的数据备份。保留附件与工作卷。不要运行 `docker compose down -v`，除非明确要删除服务数据。

## 验收

在具备 Docker 的 Linux 主机或 CI 执行：

```sh
DOMOS_CONTAINER_TESTS=1 pnpm exec vitest run packages/agent/test/container.test.ts
```

测试使用真实 Docker 和 Pi daemon。覆盖上传 CSV、执行、下载、重建恢复、两个 Bot 共享、不同电脑隔离、网络、超时、取消，以及 Pi 官方环境一致性。设置 `DOMOS_TEST_CONFIG` 可使用仅含 SSH 接入信息的测试配置。测试不调用付费模型。工作镜像须已构建；受限网络须已安装规则。

本地常规测试不启用此套件。CI 分别运行本机 Docker 和 SSH 传输，并检查应用镜像重建后的数据保留。
