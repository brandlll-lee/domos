export const mcpApps = [
  {
    id: "microsoft-learn",
    name: "Microsoft Learn",
    icon: "BookOpen",
    category: "资料",
    description: "搜索 Microsoft 官方文档和代码示例。",
    examples: [
      "查找 ASP.NET Core 身份验证的官方文档。",
      "给我一个 Microsoft Graph 的代码示例。",
      "核对这段 Azure 配置的官方说明。",
    ],
    preparation: "无需登录。需要网络连接。",
    documentation: "https://learn.microsoft.com/training/support/mcp",
    config: {
      transport: "http" as const,
      url: "https://learn.microsoft.com/api/mcp",
      headers: {},
    },
  },
  {
    id: "context7",
    name: "Context7",
    icon: "Code",
    category: "开发",
    description: "查询软件库的最新文档。",
    examples: [
      "查找 React useEffect 的最新用法。",
      "用当前版本的 Next.js 文档解释路由配置。",
      "对照官方文档，检查这段 API 调用。",
    ],
    preparation: "可直接测试。服务有使用额度；可选登录或填写自己的 Key。",
    documentation: "https://context7.com/docs/resources/all-clients",
    config: {
      transport: "http" as const,
      url: "https://mcp.context7.com/mcp",
      headers: {},
    },
  },
];
