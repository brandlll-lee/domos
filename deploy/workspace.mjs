import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

await mkdir(process.env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
const children = new Set();
let closing = false;
function close(code) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => process.exit(code), 3000);
  timer.unref();
  Promise.all(
    [...children].map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once("close", resolve);
        }),
    ),
  ).then(() => process.exit(code));
}
function start(program, args) {
  const child = spawn(program, args, { stdio: "ignore" });
  children.add(child);
  child.once("error", () => close(1));
  child.once("exit", () => close(1));
  return child;
}
process.once("SIGTERM", () => close(0));
process.once("SIGINT", () => close(0));
start("dbus-daemon", [
  "--session",
  "--nofork",
  `--address=${process.env.DBUS_SESSION_BUS_ADDRESS}`,
]);
start("Xvfb", [
  process.env.DISPLAY,
  "-screen",
  "0",
  "1440x900x24",
  "-nolisten",
  "tcp",
  "-noreset",
  "-ac",
]);
const deadline = Date.now() + 10000;
while (!closing) {
  const ready = await new Promise((resolve) => {
    const check = spawn("xdpyinfo", [], { stdio: "ignore" });
    check.once("error", () => resolve(false));
    check.once("exit", (code) => resolve(code === 0));
  });
  if (ready) break;
  if (Date.now() >= deadline) close(1);
  await delay(100);
}
if (!closing) {
  start("openbox", []);
  start("pcmanfm", ["--desktop"]);
}
