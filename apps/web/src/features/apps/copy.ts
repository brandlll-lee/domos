export const appsCopy = {
  status: {
    configured: "已配置",
    ready: "可用",
    authorization_required: "待授权",
    failed: "检查失败",
  },
  readError: "连接读取失败，请重试。",
  nativeReadError: "原生连接读取失败，请重试。",
  secretHint: "留空保留已有配置和凭据。填写新配置会替换它们。",
};

export function nativeMcpNotice(
  catalog: import("@domos/agent/harness/types").EngineMcpCatalog,
) {
  const labels = {
    complete: "",
    partial: "部分目录读取失败",
    failed: "原生目录读取失败",
    unsupported: "此 Harness 尚未提供目录接口",
  };
  return [
    labels[catalog.status],
    ...catalog.errors.map((error) => error.message),
  ]
    .filter(Boolean)
    .join("。 ");
}

export function nativeMcpStatus(
  item: import("@domos/agent/harness/types").EngineMcpCatalog["items"][number],
) {
  const states: Record<string, string> = {
    connected: "已连接",
    pending: "等待连接",
    connecting: "连接中",
    disabled: "已停用",
    disconnected: "连接已断开",
    failed: "连接失败",
    "needs-auth": "需要授权",
    needs_auth: "需要授权",
    needs_client_registration: "需要客户端注册",
    unknown: "连接状态未知",
  };
  return [
    item.enabled === null ? "启用状态未知" : item.enabled ? "已启用" : "已停用",
    states[item.status] ?? `原生状态：${item.status}`,
    item.authStatus ? `认证：${item.authStatus}` : "",
    item.error,
  ]
    .filter(Boolean)
    .join(" · ");
}
