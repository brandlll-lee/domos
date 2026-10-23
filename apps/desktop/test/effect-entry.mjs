import { EventEmitter } from "node:events";
import { app } from "electron";
import { openDesktopOverlay } from "../../../packages/agent/src/harness/desktop-overlay.mjs";

app.setName("Domos effects test");
const channel = Object.assign(new EventEmitter(), { send() {} });
process.on("computer-effect-input", (value) => channel.emit("message", value));
openDesktopOverlay(channel).catch(() => app.exit(1));
