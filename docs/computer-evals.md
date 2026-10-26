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

共享执行入口的回归使用 `packages/agent/test/computer-input.test.ts`。它检查严格 MCP 输出校验、批次窗口身份、默认收尾观察、增量基线兼容性、重复批次限制，以及观察失败后保留已执行步骤并阻止重放。`computer-assistant.test.ts` 检查主 Agent 的批次工具目录、Jev 交接与不可用工具提示。

Windows 图形会话可运行原生模拟：

```sh
pnpm exec playwright test --config apps/desktop/playwright.config.ts apps/desktop/test/computer-effect.spec.ts --grep "foreground input keeps"
```

模拟窗口验证控件与前台两条路径，并读回输入值、按钮结果和光标位置。它还检查批次观察的窗口身份，以及失败的 `expect` 是否阻止后续输入。它不调用在线模型。Domos 补充状态放在文本内容中，原生结构化结果遵守工具输出协议。`domos.verification` 的 `confirmed` 表示驱动确认动作效果，`checked` 表示请求的后置条件通过，`required` 表示仍需核对。`domos.observation: failed` 时只恢复观察，不能重放已投递动作。上述结果都不等于完整用户任务验收。

## 浏览器接管验收

`browser-failures.json` 的 `takeoverViewport` 保存画面 1262×568、报告尺寸 1280×720 的脱敏基线。它也记录输入框与按钮高度不一致，以及键盘事件缺失。

```sh
pnpm test apps/web/test/viewer-input.test.ts
pnpm build
pnpm exec playwright test apps/web/test/browser-takeover.spec.ts
```

接管验收使用独立临时数据目录、真实 agent-browser 和 Cua 窗口捕获。工作浏览器运行在图形会话中。Linux 使用 Xvfb。测试先通过原生地址栏打开专用网页。专用网页把实际值、焦点、选择范围、按键和滚动位置回传给测试服务。测试从 Domos 画面点击字段，不预先用脚本聚焦。覆盖中文追加、全选替换、删除、剪贴板粘贴、Tab、Esc、回车、悬停、拖动选字、滚动和交还。Chromium 的 CDP 输入法接口覆盖组词与提交；它不证明所有系统输入法候选窗口均可用。测试接口见 [Playwright CDPSession](https://playwright.dev/docs/api/class-cdpsession) 和 [Chrome Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/)。

失败用例中只有故障注入拦截一次输入请求。它检查暂停、重新连接和输入不被自动重放。正常动作仍使用真实浏览器。队列测试检查动作顺序、未知结果后的停止、移动合并和容量上限。

Playwright 保存 1440、768、390 宽度的截图，并检查固定身份区、三个 Tab、等比画面、底栏和全屏恢复。桌面端验收另行检查原生窗口全屏与恢复。Checks 在三个系统运行通用回归，保存 `test-results/web.xml`、失败轨迹和截图。原生浏览器画面用例在 Windows 和 Linux 运行。macOS CI 跳过三项原生画面用例；本地 Mac 需要先按 [Cua 官方流程](https://cua.ai/docs/cua-driver/quickstart) 授予屏幕录制和辅助功能权限，再执行验收。Computer effects 同时运行坐标与输入队列测试。未 push 的提交没有远端 CI 结果。此验收不调用模型，不报告模型成功率或轮数改善。
