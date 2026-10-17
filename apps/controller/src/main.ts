import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DockerComputer } from "@domos/agent/computer/docker";
import { computerSchema } from "@domos/agent/config";
import { z } from "zod";
import { controlServer } from "./server.ts";

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error("需要控制端配置。");
  const config = z
    .object({
      host: z.string().default("127.0.0.1"),
      port: z.number().int().min(1).max(65535),
      credentialFile: z.string(),
      computer: computerSchema,
    })
    .strict()
    .parse(JSON.parse(await readFile(filename, "utf8")));
  if (config.computer.kind !== "docker")
    throw new Error("控制端需要工作沙箱。");
  const token = (
    await readFile(resolve(dirname(filename), config.credentialFile), "utf8")
  ).trim();
  if (token.length < 32) throw new Error("控制端凭据无效。");
  const template = config.computer;
  const controller = controlServer(
    new DockerComputer(template),
    token,
    (id) => new DockerComputer({ ...template, id, volume: `domos-${id}-work` }),
  );
  const close = () =>
    void controller.close().then(() => {
      if (process.connected) process.disconnect();
    });
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  process.on("message", (message) => {
    if (message === "shutdown")
      void controller.close().then(() => process.exit());
  });
  const parent = (
    process as NodeJS.Process & {
      parentPort?: {
        on(
          event: "message",
          listener: (event: { data: unknown }) => void,
        ): void;
      };
    }
  ).parentPort;
  parent?.on("message", (event) => {
    if (event.data === "shutdown")
      void controller.close().then(() => process.exit());
  });
  controller.server.once("error", () => {
    process.exitCode = 1;
    close();
  });
  controller.server.listen(config.port, config.host, () =>
    console.log("Domos 工作电脑控制端已启动。"),
  );
}

main().catch(() => {
  console.error("控制端启动失败。请检查配置和运行时。");
  process.exitCode = 1;
});
