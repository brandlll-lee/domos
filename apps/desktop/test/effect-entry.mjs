import { EventEmitter } from "node:events";
import { app } from "electron";
import { openDesktopOverlay } from "../../../packages/agent/src/harness/desktop-overlay.mjs";

app.setName("Domos effects test");
const channel = Object.assign(new EventEmitter(), { send() {} });
let heartbeat;
process.on("computer-effect-input", (value) => {
  channel.emit("message", value);
  if (value?.type === "capture") return;
  clearInterval(heartbeat);
  if (value)
    heartbeat = setInterval(
      () =>
        channel.emit("message", { ...value, expiresAt: Date.now() + 10000 }),
      500,
    );
});
process.on("computer-effect-disconnect", () => clearInterval(heartbeat));
openDesktopOverlay(channel).catch(() => app.exit(1));
