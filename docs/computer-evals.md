# Computer Use evals

这是离线轨迹评测。它读取已经完成的任务，不操作电脑，不调用模型，也不产生模型费用。

## 运行

在仓库根目录运行保存的历史失败样本：

```sh
pnpm eval:computer
```

默认样本摘录自任务 7094。它保留三个已知流程问题，因此预期返回 `0/3`，退出码为 `1`。样本中的路径、进程编号和输入文字已经简化。该样本的 `completion: pass` 来自人工核对：歌曲、歌手、歌词页正确，连续截图中的播放进度向前推进。没有验证扬声器出声。

评测新的 OpenCode 任务，在 PowerShell 中运行：

```powershell
pnpm eval:computer --task 7094 --domos-db "$env:APPDATA/@domos/desktop/hosting/data/agent.sqlite" --opencode-db "$env:USERPROFILE/.local/share/opencode/opencode.db"
```

把 `7094` 换成新任务编号。编号来自 Domos 日志中的 `taskId`。数据库位置以服务和 OpenCode 实际运行的电脑为准。命令以只读方式打开两份数据库。OpenCode 原始记录用于取得完整参数，避免聊天摘要中空参数的影响。导入失败会报错，不会退回缺少参数的摘要继续评分。

其他 Harness 可提供同一结构的轨迹 JSON：

```sh
pnpm eval:computer --trace trace.json
```

结构参考 `packages/agent/test/fixtures/computer-eval.json`。公共契约支持 Pi、Claude、Codex、OpenCode；首期原生日志导入器仅支持 OpenCode。

## 读报告

| 检查 | 判定规则 |
| --- | --- |
| `inputVerification` | 输入、按键或输入批次含 `not verified` 投递标记时，记录流程风险。它不证明输入最终失败，也不判断后续截图是否完成验证。 |
| `incrementalScope` | 同一目标改变树读取范围后，仍请求旧范围的增量，且驱动明确返回没有兼容基线时，记录回退。主动换范围有时合理，需结合任务复核。 |
| `availableTools` | 工具结果明确报告 `unavailable tool` 或 `unknown tool` 时失败。 |

`checks.calls` 使用从 1 开始的调用序号。`checkPassRate` 只表示上述流程规则的通过率，不是任务成功率。没有覆盖的项目标为 `not-exercised`；全部未覆盖时，通过率为 `null`。

`completion` 单独记录人工任务验收。原生日志导入默认 `unreviewed`，不会把 Agent 自称完成或任务正常结束自动算作成功。人工验收必须查看任务要求与独立证据。

`coverage: complete` 报告完整任务的耗时、工具调用数、模型响应轮数、工具时间和固定睡眠次数。并行工具时间只计算一次。工具以外的时间包括模型、通信、调度，不能全部称作模型思考。`coverage: excerpt` 不计算完整工具时间或剩余时间。

退出码：`0` 表示三项流程规则通过；`1` 表示规则发现问题；`2` 表示数据无效或存在未覆盖项目。它们不替代人工任务验收。

## 回归流程

浏览器执行契约见 [Browser Use](browser-use.md)。脱敏基线保存在 `packages/agent/test/fixtures/browser-failures.json`。它记录取消后页面丢失、超时后动作继续、审批回调缺失和跨服务接管问题。它是驱动基线，不是在线 Agent 任务成功率。

浏览器与共享控制回归：

```sh
pnpm exec vitest run packages/agent/test/browser-runtime.test.ts packages/agent/test/computer-control.test.ts packages/agent/test/computer-services.test.ts packages/agent/test/computer-assistant.test.ts
```

原生超时用例会等待底层约 30 秒的响应超时，再读回第 35 秒发生的页面变化。测试同时检查未知状态阻断和显式重启。取消用例使用页面发出的事件确认动作开始，再接管并读回输入值。运行耗时不是模型性能数据。Checks 在三个操作系统运行这些用例，并保存 JUnit 报告。

修改 Harness 前，先保存同任务、同主模型的基线。修改后，重新执行真实任务，再评测新任务记录。保留通过数、任务完成情况、耗时和模型轮数；历史摘录不会随代码更新自动变绿。

新失败先加入小型脱敏样本，再补相应规则的正反例。运行评分器回归：

```sh
pnpm exec vitest run packages/agent/test/computer-evals.test.ts
```

这些测试验证评分器，不代表重新运行了 Agent。当前未提供自动截图判分、自动真实任务重跑或跨平台桌面成功率。

共享执行入口的回归使用 `packages/agent/test/computer-input.test.ts`。它检查原生目录、严格输出校验、图片、错误和 MCP 元数据。动作、批次、脚本、启动及剪贴板请求都只转发一次，参数保持原样。原生会话错误由 Agent 处理。外层动作记录阻止同一已发请求被重放。原生宿主持有桌面光标和会话。`harness-projection.test.ts` 使用受控慢存储检查事件继续接收、稀疏更新、真实接收时间、停止隔离及最终写入。原生会话接收确认仍须先落盘。

Windows 图形会话可运行原生模拟：

```sh
pnpm exec playwright test --config apps/desktop/playwright.config.ts apps/desktop/test/computer-input.spec.ts
```

模拟窗口读回控件输入、前台输入、连续脚本输入和按钮结果。会话结束后，测试显式开始新会话。需要批次收尾观察时，测试显式传入 observe。批次检查失败后停止。此 E2E 不调用在线模型。Domos 状态放在文本内容中。原生结构化输出遵守工具格式。`confirmed` 表示驱动确认效果，`checked` 表示后置条件通过，`required` 表示仍须核对。观察失败时保留动作结果，只恢复观察。这些状态不等于完整用户任务完成。

## 浏览器接管验收

`browser-failures.json` 的 `takeoverViewport` 保存画面 1262×568、报告尺寸 1280×720 的脱敏基线。它也记录输入框与按钮高度不一致，以及键盘事件缺失。

```sh
pnpm test apps/web/test/viewer-input.test.ts
pnpm build
pnpm exec playwright test apps/web/test/browser-takeover.spec.ts
```

接管验收使用独立临时数据目录和真实 agent-browser 网页画面流。工作浏览器默认无界面运行。测试通过 Agent 使用的浏览器工具打开专用网页，再从 Domos 接管。专用网页把实际值、焦点、选择范围、按键和滚动位置回传给测试服务。测试从 Domos 画面点击字段，不预先用脚本聚焦。覆盖中文追加、全选替换、删除、剪贴板粘贴、Tab、Esc、回车、悬停、拖动选字、滚动和交还。Chromium 的 CDP 输入法接口覆盖组词与提交；它不证明所有系统输入法候选窗口均可用。测试接口见 [Playwright CDPSession](https://playwright.dev/docs/api/class-cdpsession) 和 [Chrome Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/)。

失败用例中只有故障注入拦截一次输入请求。它检查暂停、重新连接和输入不被自动重放。正常动作仍使用真实浏览器。队列测试检查动作顺序、未知结果后的停止、移动合并和容量上限。

Playwright 保存 1440、768、390 宽度的截图，并检查固定身份区、四个 Tab、等比画面、底栏和全屏恢复。空状态回归检查连接中、未启用、未就绪和失败状态的水平居中及内容边界。桌面端验收另行检查原生窗口全屏与恢复。Checks 在三个系统运行网页画面和通用回归，保存 `test-results/web.xml`、失败轨迹和截图。Browser 验收不依赖 Cua 窗口捕获或屏幕录制授权。Computer 的原生桌面仍受系统图形会话和权限限制。Computer input 同时运行坐标与输入队列测试。未 push 的提交没有远端 CI 结果。此验收不调用模型，不报告模型成功率或轮数改善。

接管消息使用真实共享执行入口和真实浏览器验收。Durable 工具与共享接管测试检查等待卡片、完成前输入排空、完成后恢复和过期请求。浏览器回归还检查刷新后等待与完成状态、卡片打开正确画面、中文输入后 Agent 重新读回实际值。截图作为测试产物保存。桌面卡片的控制权使用同一入口；原生桌面输入仍需相应系统环境验收。

## 浏览器模式与侧栏过渡

`browser-failures.json` 保存无界面／有界面的同机访问基线，以及侧栏打开时聊天宽度单帧跳变的基线。X 的结果只适用于记录中的环境与页面，不代表全部网站。在线访问不作为确定性的 CI 门槛。

`browser-runtime.test.ts` 检查模式持久化、相同资料目录、启动失败后的回退、HTTP 拒绝与网络错误证据。`computer-control.test.ts` 检查切换期间浏览器与桌面的共同锁，以及失败后的释放。`computer-services.test.ts` 用真实 Chrome 检查本地 403、登录表单、验证页面信号和切换后的 localStorage 保留。它不验证真实站点的 OAuth 会话或所有 Cookie 生命周期。

`browser-takeover.spec.ts` 从聊天卡片接管，完成后在设置中确认模式切换，再通过缩放画面点击并输入，最后读回真实页面。`workspace.spec.ts` 记录连续开关的逐帧数据，并覆盖 1360、768、390 宽度及减少动态效果。检查消息可见、底部位置和草稿保留。已有四倍 CPU 降速拖拽测试记录布局、脚本和样式耗时。布局快照动画不等于逐帧修改 DOM 宽度；不能用 DOM 宽度只有两个值判定动画缺失。

Checks 在 Linux 图形测试中使用 Xvfb。Windows 本地测试不证明其他系统已通过。未 push 的提交没有远端 CI 结果。上述测试不调用在线模型，不能报告 Agent 任务成功率或模型响应速度改善。

连续操作基线保存在 `browser-failures.json` 的 `continuousInput`。回归按动画帧发送 120 次滚动，检查接管保持、交还完成和暂停次数。拖动用例在松开鼠标前读回选区。命令接口单测验证 Origin、回复确认、回复大小和取消。队列单测检查连续滚动、反向、按键及完成操作的顺序。Checks 与 Computer input 包含这些测试。测试不依赖在线模型，不把协议测试或帧率上限当成性能改善数据。

## 首次接管与浏览器观察

`computer-control.test.ts` 用事件控制交接等待。它让同一个画面在交接期间取帧和确认帧，检查提前输入被阻止、重复接管共用一次交接、其他窗口被拒绝，以及关闭或失败后的凭证清理。Browser 和 Computer 使用同一共享服务回归。该测试不验证原生桌面输入。

`computer-services.test.ts` 从未准备的独立浏览器会话开始，检查首次 MCP 命令在 10 秒内返回。该上限针对本地空白浏览器启动和标签列表，不用于公网导航或模型回答。原生测试还检查批次输入与点击的实际结果，以及正常留白、加载提示和错误页的正文、标题和就绪状态。分段耗时写入 `test-results/browser-latency-<platform>.json`。五秒观察预算作用于原生命令；原生超时收尾仍可能超出这个预算。

接管卡片测试从聊天任务开始打开专用网页，不预先打开画面或手动接管。它分别测试直接点击和刷新后点击。一次点击必须进入控制状态，不允许先重新连接。测试通过缩放画面点击输入框，输入中文，并检查真实页面值和画面中的颜色标记。`inputToPaintMs` 包含输入调用、真实画面传输、解码和测试轮询，属于该测试环境的测量上界。它不是单独的 CDP 或显示器延迟。

完成后，共享执行入口调用只读观察并返回新值。`takeover-flow.json` 保存首次点击成功、冲突数、卡片等待、交接、读回、输入到画面变化、总耗时和工具耗时。`continuous-input.json` 保存滚动压力数据。测试使用脚本 Harness 和真实浏览器，不调用在线模型，不代表模型任务成功率或轮数改善。Checks 在三个系统运行并上传这些产物。版本对照与历史会话边界见 [调查与验证记录](reports/browser-takeover-2026-10-26.md)。

共享 MCP 回归还检查结构裁剪后的 JSON、完整应用记录的 JMESPath 只读查询、有效查询示例、无效表达式错误、成功与失败结果的截图通道，以及重复请求去重。电脑调用不创建逐次 ToolTask。意图先落盘，原始结果随后落盘；结果未知的同一请求不会重放。任务 9843 的脱敏基线见 `cua-contracts.json` 中的 `playerDiscovery`。任务 10789 的应用查询失败及 122.5 秒递归扫描基线见 `nativeDiscovery`。桌面 E2E 通过实际 MCP 目录调用 list_apps，并核对 JMESPath 返回的原生应用数量。
