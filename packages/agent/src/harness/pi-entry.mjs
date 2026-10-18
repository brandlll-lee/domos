import {
  createBashTool,
  createPowerShellTool,
} from "@earendil-works/pi-coding-agent";

const windows = process.platform === "win32";
const shell = windows
  ? createPowerShellTool(process.cwd())
  : createBashTool(process.cwd());

let error;
try {
  await shell.execute("domos-check", { command: "echo domos", timeout: 10 });
} catch {
  error = windows
    ? "Pi 无法在工作目录运行 PowerShell。请检查 PowerShell 安装、目录和执行权限。"
    : "Pi 无法在工作目录运行 Bash。请检查 Bash 安装、目录和执行权限。";
}
process.stdout.write(`${JSON.stringify({ type: "domos_ready", error })}\n`);
if (error) process.exitCode = 1;
else {
  if (windows) process.argv.push("--tools", "-bash,+powershell");
  await import("@earendil-works/pi-coding-agent/rpc-entry");
}
