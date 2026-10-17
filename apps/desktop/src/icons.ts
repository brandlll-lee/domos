import { fileURLToPath } from "node:url";
import { nativeImage } from "electron";

export const applicationIcon = nativeImage.createFromPath(
  fileURLToPath(new URL("./icon.png", import.meta.url)),
);
