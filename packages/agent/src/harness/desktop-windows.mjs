import { app, desktopCapturer } from "electron";

let active = false;
let timer;
let pending;
async function refresh() {
  if (!active || pending) return;
  clearTimeout(timer);
  timer = undefined;
  try {
    pending = desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 0, height: 0 },
    });
    const sources = await pending;
    if (process.connected)
      process.send(
        {
          type: "windows",
          ids: sources.map((source) => source.id.split(":")[1]),
        },
        () => {},
      );
  } catch {
  } finally {
    pending = undefined;
    if (active) timer = setTimeout(refresh, 500);
  }
}
app
  .whenReady()
  .then(() => {
    process.on("message", (value) => {
      active = value === true;
      if (active && !timer) void refresh();
      if (!active) {
        clearTimeout(timer);
        timer = undefined;
      }
    });
    process.send({ type: "windows-ready" }, () => {});
  })
  .catch(() => app.quit());
process.once("disconnect", () => app.quit());
app.on("before-quit", () => clearTimeout(timer));
