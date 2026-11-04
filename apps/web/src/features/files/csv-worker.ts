import Papa from "papaparse";

self.onmessage = async (event: MessageEvent<Blob>) => {
  try {
    const result = Papa.parse<string[]>(await event.data.text(), {
      preview: 501,
      skipEmptyLines: true,
    });
    self.postMessage({
      rows: result.data.slice(0, 500).map((row) => row.slice(0, 50)),
      truncated:
        result.data.length > 500 ||
        result.meta.truncated ||
        result.data.some((row) => row.length > 50),
      error: result.errors.length
        ? "部分 CSV 内容无法解析。你可以下载原文件检查。"
        : undefined,
    });
  } catch {
    self.postMessage({ rows: [], truncated: false, error: "CSV 读取失败。" });
  }
};
