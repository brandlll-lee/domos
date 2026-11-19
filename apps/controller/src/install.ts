import { chown, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  prepareInstallation,
  publishedReleaseSchema,
  writeConfiguration,
} from "@domos/hosting/install";

const directory = process.argv[2];
if (!directory) throw new Error("需要安装目录。");
await mkdir(directory, { recursive: true, mode: 0o700 });
const configFile = join(directory, "domos.config.json");
try {
  await readFile(configFile, "utf8");
  console.log("托管配置已存在。");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const manifest = process.argv[3];
  if (!manifest) throw new Error("需要正式发布清单。");
  const release = publishedReleaseSchema.parse(
    JSON.parse(await readFile(manifest, "utf8")),
  );
  release.staticDir = "/app/apps/web/dist";
  const installed = await prepareInstallation(
    directory,
    release,
    ({ message }) => console.log(message),
  );
  const config = installed.config as Record<string, unknown>;
  Object.assign(config, {
    host: "0.0.0.0",
    port: 4310,
    dataDir: "/data",
    deployment: "container",
    workComputer: {
      ...(config.computer as object),
      endpoint: "http://controller:4311",
    },
    computer: {
      ...(config.computer as object),
      endpoint: "http://controller:4311",
    },
  });
  await writeConfiguration(configFile, config);
  const controller = JSON.parse(
    await readFile(installed.controllerFile, "utf8"),
  );
  await writeConfiguration(installed.controllerFile, {
    ...controller,
    host: "0.0.0.0",
    port: 4311,
  });
  for (const item of await readdir(directory))
    await chown(join(directory, item), 1000, 1000);
  await chown(directory, 1000, 1000);
}
