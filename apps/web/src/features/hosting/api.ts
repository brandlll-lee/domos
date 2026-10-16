export async function hostingRequest<T>(
  path: string,
  input?: unknown,
  method = input === undefined ? "GET" : "POST",
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/hosting/${path}`, {
    method,
    signal,
    credentials: "same-origin",
    ...(input === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
  });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("domos:pair"));
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "连接未完成。请重试。");
  }
  return response.json();
}
