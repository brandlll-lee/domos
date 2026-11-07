# 浏览器准备流程验收

## 已确认的故障

在隔离的有界面 Chrome 中，最大化或最小化窗口后，原生 `set viewport` 会触发 `Browser.setContentsSize` 错误。错误要求先恢复普通窗口。保持原生后台的 stderr 管道开启时，请求返回成功并输出该错误。关闭管道后，相同请求返回 EOF 和 `outcome_unknown`。随后读取 URL 仍然成功。

agent-browser 0.39.4 和 0.41.2 均复现。原生视口错误分支使用 `eprintln!`。本次没有修改原生协议，也没有把 EOF 当作成功。失败样本保存在 [browser-failures.json](../../packages/agent/test/fixtures/browser-failures.json)。

## 必须修改的原因

- 准备浏览器不需要改变用户窗口。共享入口改为原生 `get url`，删除固定视口和未知结果重试。
- 模式切换已经完成原生重启和准备。上层直接使用确认结果，删除第二次准备。
- 失败启动后的再次准备必须读取真实结果。删除结果未知时跳过读取并返回可用的分支。未知动作的执行屏障保持生效。
- EOF 不是安装错误。运行失败显示重新检查。只有原生报告缺少 Chrome 时才提供安装。原始错误保留在现有折叠详情中。
- 原生会话修复通过升级到 0.41.2 取得。桌面运行包与 Docker 依赖版本同步。该版本仍有上述视口缺陷，不能把升级视为其修复。

浏览器、会话、持久配置和画面流继续由 agent-browser 管理。Domos 的授权、接管、停止和未知结果屏障保持原有职责。没有新增检测框架。

## 官方依据

- [更新记录](https://agent-browser.dev/changelog)：原生会话与 Windows 生命周期修复。
- [会话](https://agent-browser.dev/sessions)：复用原生会话和持久配置。
- [画面流](https://agent-browser.dev/streaming)：读取原生画面尺寸和状态。
- [0.41.2 视口实现](https://github.com/vercel-labs/agent-browser/blob/v0.41.2/cli/src/native/browser.rs)：窗口尺寸操作与错误输出。
- [0.41.2 后台实现](https://github.com/vercel-labs/agent-browser/blob/v0.41.2/cli/src/native/daemon.rs)：后台进程及平台相关输出处理。

## Windows 验收

| 范围 | 结果 | 耗时 |
| --- | --- | --- |
| 共享浏览器、控制权、停止、输入回归 | 87 项通过，6 个文件 | 3.50 秒 |
| 真实浏览器服务 | 5 项通过 | 77.75 秒 |
| 网页接管、错误恢复和空状态 E2E | 8 项通过 | 约 1.2 分钟 |
| 桌面设置、画面流、全屏及运行包 E2E | 2 项通过 | 18.4 秒 |
| 类型检查、lint、网页及桌面构建 | 通过；lint 保留 7 条既有警告 | 未计时 |

真实浏览器回归覆盖最大化、最小化后的准备和输入保留。接管测试通过缩放画面点击，并读取真实页面结果。错误恢复测试确认运行错误不会请求安装。

原有桌面实例已重启。Domos 的 Bot 编号仍为 1，doo 仍为 11744。原实例 Browser 面板已显示画面。图像成功解码，尺寸为 1280 × 720。数据目录未迁移。

没有调用在线模型。本次不提供任务成功率或性能提升结论。没有验证 Linux、macOS 或 Docker 构建。网站安全验证是否放行不属于本次验收。
