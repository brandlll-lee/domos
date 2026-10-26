export async function browserCommand(port, command, signal) {
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(`${origin}/api/command`, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(command),
    signal,
  });
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > 65536) throw new Error("浏览器输入回执过大。");
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  const result = JSON.parse(text);
  if (!response.ok || result.success !== true)
    throw new Error("浏览器未确认输入。请检查页面。");
  return result.data;
}
