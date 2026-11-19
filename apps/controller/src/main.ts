import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  DockerComputer,
  prepareDockerImage,
} from "@domos/agent/computer/docker";
import { computerSchema, identifier } from "@domos/agent/config";
import { releaseSchema, writeConfiguration } from "@domos/hosting/install";
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
  const imagesFile = join(dirname(filename), "computers.json");
  const imagesSchema = z.object({
    image: z.string().min(1),
    proxyImage: z.string().optional(),
  });
  let retained: Record<string, z.infer<typeof imagesSchema>>;
  try {
    retained = z
      .record(identifier, imagesSchema)
      .parse(JSON.parse(await readFile(imagesFile, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    retained = {};
  }
  const released = process.env.DOMOS_WORK_IMAGE
    ? {
        image: releaseSchema.shape.workImage
          .unwrap()
          .parse(process.env.DOMOS_WORK_IMAGE),
        proxyImage: releaseSchema.shape.proxyImage.parse(
          process.env.DOMOS_PROXY_IMAGE,
        ),
      }
    : undefined;
  const create = (id: string) =>
    new DockerComputer({
      ...template,
      ...retained[id],
      id,
      volume: id === template.id ? template.volume : `domos-${id}-work`,
    });
  let saving: Promise<void> = Promise.resolve();
  const controller = controlServer(
    create(template.id),
    token,
    create,
    async (driver, action) => {
      if (!released) return driver;
      const current = create(driver.config.id);
      if (action === "start") {
        const volume = await current.command([
          "docker",
          "volume",
          "ls",
          "--quiet",
          "--filter",
          `name=^${current.config.volume}$`,
        ]);
        if (volume.trim()) return driver;
      }
      for (const image of [released.image, released.proxyImage])
        if (image)
          await prepareDockerImage(image, current.command.bind(current));
      saving = saving
        .catch(() => {})
        .then(async () => {
          const next = { ...retained, [driver.config.id]: released };
          await writeConfiguration(imagesFile, next);
          retained = next;
        });
      await saving;
      return create(driver.config.id);
    },
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
