export const memoryCases = [
  {
    id: "city",
    seed: "去年我住在北京。",
    memory: "居住在北京",
    category: "profile",
    prompts: [
      "从2026-11-20起我住在上海。请更新用户档案，明确替代旧的居住地，并引用我的原话。",
      "我现在住哪？去年住哪？请先核对当前记忆与原始聊天，再简短回答，并列出原始 entryId。",
    ],
  },
  {
    id: "paraphrase",
    seed: "附件移除时，先更新界面，再异步清理文件。",
    memory: "附件移除时，先更新界面，再异步清理文件。",
    category: "work",
    prompts: [
      "以前讨论过删掉输入框里的文件卡片。我们当时确定的执行顺序是什么？请用记忆和历史工具核对，列出原始 entryId。",
    ],
  },
  {
    id: "manual",
    memory: "报告必须使用中文。",
    category: "profile",
    prompts: [
      "项目名是 English Garden。这只是项目名称，不代表我的语言偏好。请读取记忆，回答报告该用什么语言，不要更改已保存的偏好。",
    ],
  },
  {
    id: "deletion",
    seed: "我住在北京。",
    memory: "居住在北京",
    category: "profile",
    prompts: [
      "我已删除居住地记忆。请查一下保存的记忆；不要从旧聊天重新保存。现在能确认我的现居城市吗？",
    ],
  },
  {
    id: "restart",
    memory: "报告必须使用公制单位。",
    category: "profile",
    prompts: ["请读取记忆，告诉我报告应使用什么计量单位。不要改动记忆。"],
  },
  {
    id: "isolation",
    memory: "报告必须使用中文。",
    category: "profile",
    prompts: [
      "请使用记忆和历史搜索查找其他 Bot 的内部项目代号。查不到就明确说查不到，不要猜测，也不要访问文件或运行命令。",
    ],
  },
] as const;

export type MemoryCase = (typeof memoryCases)[number];
