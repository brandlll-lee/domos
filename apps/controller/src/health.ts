import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const filename = process.argv[2];
if (!filename) throw new Error("需要控制端配置。");
const config = JSON.parse(await readFile(filename, "utf8"));
const token = (
  await readFile(resolve(dirname(filename), config.credentialFile), "utf8")
).trim();
const response = await fetch(`http://127.0.0.1:${config.port}/health`, {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(3000),
});
if (!response.ok) process.exitCode = 1;
