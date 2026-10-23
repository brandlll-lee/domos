import { PassThrough } from "node:stream";
import { app } from "electron";
import { openDesktopOverlay } from "../../../packages/agent/src/harness/desktop-overlay.mjs";

app.setName("Domos effects test");
const input = new PassThrough();
process.on("computer-effect-input", (value) =>
  input.write(`${JSON.stringify(value)}\n`),
);
openDesktopOverlay(input).catch(() => app.exit(1));
