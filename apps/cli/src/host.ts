import { fork } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  prepareInstallation,
  releaseSchema,
  waitForService,
} from "@domos/hosting/install";
import {
  backupInstallation,
  restoreInstallation,
} from "@domos/hosting/maintenance";
import { Sessions } from "@domos/hosting/sessions";
import { HostingStore } from "@domos/hosting/store";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      directory: { type: "string" },
      file: { type: "string" },
      "password-file": { type: "string" },
    },
  });
  if (!values.directory) throw new Error("请使用 --directory 指定托管目录。");
  const directory = resolve(values.directory);
  const command = positionals[0] ?? "start";
  if (command === "backup" || command === "restore") {
    if (!values.file || !values["password-file"])
      throw new Error("需要 --file 和 --password-file。");
    const password = (
      await readFile(values["password-file"], "utf8")
    ).trimEnd();
    if (command === "backup")
      await backupInstallation(directory, values.file, password);
    else await restoreInstallation(values.file, directory, password);
    console.log("维护操作完成。");
    return;
  }
  if (command === "pair") {
    const store = await HostingStore.open(join(directory, "data"));
    try {
      await new Sessions(store).bootstrap(join(directory, "data"));
      console.log(
        `管理员首次配对码文件：${join(directory, "data", "owner-code")}`,
      );
    } finally {
      await store.close();
    }
    return;
  }
  if (command !== "start" && command !== "install")
    throw new Error("支持 install、start、pair、backup、restore。");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const release = releaseSchema.parse(
    JSON.parse(await readFile(join(root, "deploy/release.json"), "utf8")),
  );
  release.staticDir = resolve(root, release.staticDir);
  if (release.workBuild)
    release.workBuild.context = resolve(root, release.workBuild.context);
  if (release.proxyBuild)
    release.proxyBuild.context = resolve(root, release.proxyBuild.context);
  const prepared = await prepareInstallation(
    directory,
    release,
    ({ message }) => console.log(message),
  );
  if (command === "install") {
    console.log(`托管配置：${prepared.configFile}`);
    return;
  }
  const children = [
    fork(
      fileURLToPath(new URL("../../controller/src/main.ts", import.meta.url)),
      [prepared.controllerFile],
      { stdio: ["ignore", "inherit", "inherit", "ipc"] },
    ),
    fork(fileURLToPath(new URL("../../api/src/main.ts", import.meta.url)), [], {
      env: { ...process.env, DOMOS_CONFIG: prepared.configFile },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    }),
  ];
  const cancellation = new AbortController();
  let closing: Promise<void> | undefined;
  const stop = () =>
    (closing ??= (async () => {
      cancellation.abort();
      for (const child of [...children].reverse()) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        const exited = once(child, "exit");
        child.send("shutdown");
        const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
        await exited;
        clearTimeout(timer);
      }
    })());
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  for (const child of children) child.once("exit", () => void stop());
  try {
    const config = prepared.config as { host: string; port: number };
    const origin = `http://${config.host}:${config.port}`;
    await waitForService(
      origin,
      AbortSignal.any([cancellation.signal, AbortSignal.timeout(90_000)]),
    );
    const control = JSON.parse(await readFile(prepared.controllerFile, "utf8"));
    const response = await fetch(
      `http://${control.host}:${control.port}/${control.computer.id}/start`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${(await readFile(control.credentialFile, "utf8")).trim()}`,
        },
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok) throw new Error("工作电脑未启动。请检查控制端。");
    console.log(
      `打开 ${origin}。管理员码保存在 ${join(directory, "data", "owner-code")}。`,
    );
  } catch (error) {
    await stop();
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "托管操作未完成。");
  process.exitCode = 1;
});
