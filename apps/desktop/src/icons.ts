import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, nativeImage } from "electron";

export const applicationId = app.isPackaged
  ? "app.domos.desktop"
  : "app.domos.desktop.development";
export const applicationIconPath = app.isPackaged
  ? join(process.resourcesPath, "icon.ico")
  : fileURLToPath(new URL("./icon.ico", import.meta.url));

export const applicationIcon = nativeImage.createFromPath(
  fileURLToPath(new URL("./icon.png", import.meta.url)),
);
