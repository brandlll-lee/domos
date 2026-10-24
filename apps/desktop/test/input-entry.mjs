import { app, BrowserWindow } from "electron";

app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 800, height: 600, frame: false });
  void window.loadURL(
    "data:text/html,<title>Domos input target</title><input aria-label=\"Song\" autofocus><button onclick=\"document.querySelector('output').textContent=document.querySelector('input').value\">Play</button><output></output>",
  );
});
