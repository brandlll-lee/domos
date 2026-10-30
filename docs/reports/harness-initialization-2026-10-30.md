# Domos Harness 初始化验收

任务 9518 在 31.99 秒后失败，工具调用为零。旧记录没有 RPC 请求名，因此无法确认当时阻塞的具体请求。缺少工具发现扩展的警告也出现在成功启动中，不能将该警告认定为历史超时原因。脱敏基线保存在 `packages/agent/test/fixtures/cua-contracts.json`。

Pi 子进程显式加载原生 MCP、codemode、tool-search 和 Domos 审批扩展。新任务复用进程启动时创建的会话。恢复历史时才请求原生切换。共享 JSONL 层为 Pi 和 Codex 的错误保留请求名、阶段、耗时及原生错误消息。30 秒握手期限保持不变。Stop 继续撤销执行并终止原生进程树，不等待 MCP 清理。

协议回归先确认重复建会话、工具发现警告和缺少 RPC 错误信息，再验证修正。原生 Pi 测试使用本地 MCP 服务，覆盖 codemode、deferred、连接超时和阻塞连接时的 Stop。连接超时使用原生一秒配置。Stop 要求原生进程在两秒保护期限内退出。共享生命周期回归要求五类 Harness 在关闭阻塞时仍于 500 毫秒保护期限内完成停止接口。

Windows 真实模型验收使用任务 9518 的 Pi 程序、deepseek/deepseek-flash、Bot 工作目录和存档中的 83 项工具。首次初始化 913ms。只读桌面工具实际返回屏幕尺寸与测试回执。该轮耗时 4154ms，模型响应两轮，工具调用一次。重启后恢复同一原生会话，初始化 1672ms。第二轮从原生历史读回回执，耗时 2654ms，模型响应一轮，工具调用零次。两次均未出现工具发现缺失警告。测试结束后恢复工作目录中的指令及工具清单。

`pnpm test` 通过 361 项，跳过 40 项。`pnpm typecheck` 通过。`pnpm lint` 保留 8 项已有警告。桌面端构建通过。额外的 Codex 在线图片与记忆冒烟在 150 秒期限内未完成；本次不将其计为通过，也未确认该在线等待的原因。Codex 协议和共享停止回归通过。

此验收不执行聊天发信或播放器操作。未验证其他操作系统，也不据此报告 CUA 任务成功率提升。

协议依据已核对 Pi 1.4.0 安装源码和官方 [RPC](https://pi.dev/docs/latest/rpc)、[会话命令](https://pi.dev/docs/latest/rpc-commands)、[MCP](https://pi.dev/docs/latest/mcp)。
