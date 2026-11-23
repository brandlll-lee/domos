import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  backupInstallation,
  restoreInstallation,
} from "@domos/hosting/maintenance";
import { dialog } from "electron";
import { z } from "zod";
import type { LocalHost } from "./host.ts";

export async function maintain(
  host: Pick<
    LocalHost,
    "directory" | "dataDirectory" | "stop" | "start" | "setMaintenance"
  >,
  input: unknown,
) {
  if (z.object({ action: z.literal("compact") }).safeParse(input).success) {
    await host.setMaintenance(true);
    try {
      await host.stop();
      const result = await new Promise<{ reclaimedBytes: number }>(
        (resolve, reject) => {
          const worker = new Worker(
            new URL("./maintenance-worker.mjs", import.meta.url),
            { workerData: join(host.dataDirectory, "agent.sqlite") },
          );
          let result: { reclaimedBytes: number } | undefined;
          worker.once("message", (value) => {
            result = value;
          });
          worker.once("error", reject);
          worker.once("exit", (code) => {
            if (code === 0 && result) resolve(result);
            else reject(new Error("数据库整理未完成。"));
          });
        },
      );
      return {
        message: `数据库整理完成，回收 ${result.reclaimedBytes} 字节。`,
      };
    } finally {
      await host.start(() => {}, AbortSignal.timeout(120_000));
      await host.setMaintenance(false);
    }
  }
  const { action, password } = z
    .object({
      action: z.enum(["backup", "restore"]),
      password: z.string().min(12).max(1024),
    })
    .parse(input);
  const file =
    action === "backup"
      ? await dialog.showSaveDialog({
          title: "保存加密备份",
          defaultPath: "Domos.domos",
          filters: [{ name: "Domos 备份", extensions: ["domos"] }],
        })
      : await dialog.showOpenDialog({
          title: "选择备份",
          properties: ["openFile"],
          filters: [{ name: "Domos 备份", extensions: ["domos"] }],
        });
  const filename = "filePath" in file ? file.filePath : file.filePaths[0];
  if (file.canceled || !filename) return;
  if (action === "backup") {
    await host.stop();
    await backupInstallation(host.directory, filename, password);
    return {
      message: "备份已加密保存。后台已停止。请从应用菜单打开本机 Domos。",
    };
  }
  const folder = await dialog.showOpenDialog({
    title: "选择恢复目录的上级文件夹",
    properties: ["openDirectory", "createDirectory"],
  });
  if (folder.canceled || !folder.filePaths[0]) return;
  await host.stop();
  const directory = join(folder.filePaths[0], `Domos-${Date.now()}`);
  await restoreInstallation(filename, directory, password);
  return { directory, message: "恢复完成。请从应用菜单打开本机 Domos。" };
}
