import { spawn } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pipeline } from "node:stream/promises";
import { DockerComputer, hostCommand } from "@domos/agent/computer/docker";
import { parseConfig } from "@domos/agent/config";
import { acquireDataLease } from "@domos/agent/lease";
import { create, extract } from "tar";
import { runCommand, writeConfiguration } from "./install.ts";

const magic = Buffer.from("DOMOS001");
const headerSize = magic.length + 16 + 12;

async function workArchive(
  directory: string,
  archive: string,
  restore: boolean,
) {
  const controllerFile = join(directory, "controller.json");
  let controller: { computer: unknown };
  try {
    controller = JSON.parse(await readFile(controllerFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const config = parseConfig(
    { computer: controller.computer },
    controllerFile,
  ).computer;
  if (config.kind !== "docker")
    throw new Error("此工作环境需要先导出工作文件。");
  const driver = new DockerComputer(config);
  if (!restore) await driver.stop();
  if (restore) {
    config.id = randomBytes(6).toString("hex");
    const volume = `domos-${config.id}-work`;
    config.volume = volume;
    const [program, ...args] = hostCommand(config, [
      "docker",
      "volume",
      "create",
      volume,
    ]);
    if (!program) throw new Error("Docker 不可用。");
    await runCommand(program, args);
    controller.computer = config;
    await writeConfiguration(controllerFile, controller);
  }
  const command = hostCommand(config, [
    "docker",
    "run",
    "--rm",
    ...(restore ? ["-i"] : []),
    "--network=none",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--user=1000:1000",
    "--mount",
    `type=volume,source=${config.volume},target=/home/domos${restore ? "" : ",readonly"}`,
    config.image,
    "tar",
    restore ? "xf" : "cf",
    "-",
    "-C",
    "/home/domos",
    ...(restore ? [] : ["."]),
  ]);
  const [program, ...args] = command;
  if (!program) throw new Error("工作文件归档命令缺失。");
  const child = spawn(program, args, {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("工作文件归档未完成。")),
    );
  });
  const removeVolume = async () => {
    const [program, ...args] = hostCommand(config, [
      "docker",
      "volume",
      "rm",
      config.volume,
    ]);
    if (program) await runCommand(program, args);
  };
  try {
    if (restore) {
      child.stdout.resume();
      await Promise.all([
        pipeline(createReadStream(archive), child.stdin),
        exited,
      ]);
    } else {
      child.stdin.end();
      await Promise.all([
        pipeline(child.stdout, createWriteStream(archive, { mode: 0o600 })),
        exited,
      ]);
    }
  } catch (error) {
    if (restore) await removeVolume();
    throw error;
  }
  return { config, removeVolume };
}

export async function backupInstallation(
  directory: string,
  output: string,
  password: string,
) {
  if (password.length < 12) throw new Error("备份密码至少需要 12 个字符。");
  const root = resolve(directory);
  const target = resolve(output);
  const distance = relative(root, target);
  if (
    !isAbsolute(distance) &&
    distance !== ".." &&
    !distance.startsWith(`..${sep}`)
  )
    throw new Error("请将备份保存到安装目录之外。");
  const configFile = join(root, "domos.config.json");
  const config = parseConfig(
    JSON.parse(await readFile(configFile, "utf8")),
    configFile,
  );
  const release = await acquireDataLease(config.dataDir);
  const stage = await mkdtemp(join(tmpdir(), "domos-backup-"));
  try {
    await cp(root, join(stage, "installation"), {
      recursive: true,
      filter: (path) =>
        ![
          "runtime.sqlite",
          "runtime.sqlite-wal",
          "runtime.sqlite-shm",
        ].includes(basename(path)),
    });
    if (config.dataDir !== join(root, "data"))
      throw new Error("请先将持久数据迁入托管安装目录。");
    await workArchive(root, join(stage, "work.tar"), false);
    const plaintext = join(stage, "backup.tar.gz");
    const entries = ["manifest.json", "installation"];
    try {
      await stat(join(stage, "work.tar"));
      entries.push("work.tar");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(
      join(stage, "manifest.json"),
      JSON.stringify({
        version: 1,
        created: Date.now(),
        work: entries.includes("work.tar"),
      }),
    );
    await create(
      { file: plaintext, cwd: stage, gzip: true, portable: true },
      entries,
    );
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      scryptSync(password, salt, 32),
      iv,
    );
    cipher.setAAD(magic);
    const handle = await open(target, "wx", 0o600);
    await handle.write(Buffer.concat([magic, salt, iv]));
    await handle.close();
    try {
      await pipeline(
        createReadStream(plaintext),
        cipher,
        createWriteStream(target, { flags: "a" }),
      );
      await appendFile(target, cipher.getAuthTag());
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
    await release();
  }
}

export async function restoreInstallation(
  archive: string,
  destination: string,
  password: string,
) {
  const target = resolve(destination);
  try {
    await lstat(target);
    throw new Error("请恢复到新的安装目录。");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(target), { recursive: true });
  const stage = await mkdtemp(join(dirname(target), ".domos-restore-"));
  let work: Awaited<ReturnType<typeof workArchive>>;
  try {
    const handle = await open(archive, "r");
    const size = (await handle.stat()).size;
    const header = Buffer.alloc(headerSize);
    const tag = Buffer.alloc(16);
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, 16, size - 16);
    await handle.close();
    if (
      size <= headerSize + 16 ||
      !header.subarray(0, magic.length).equals(magic)
    )
      throw new Error("备份格式无效。");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      scryptSync(password, header.subarray(8, 24), 32),
      header.subarray(24),
    );
    decipher.setAAD(magic);
    decipher.setAuthTag(tag);
    const plaintext = join(stage, "backup.tar.gz");
    await pipeline(
      createReadStream(archive, { start: headerSize, end: size - 17 }),
      decipher,
      createWriteStream(plaintext, { mode: 0o600 }),
    );
    await extract({
      file: plaintext,
      cwd: stage,
      strict: true,
      preserveOwner: false,
      filter: (path, entry) =>
        !path.startsWith("/") &&
        !path.split(/[\\/]/).includes("..") &&
        (!("type" in entry) ||
          (entry.type !== "SymbolicLink" && entry.type !== "Link")),
    });
    const manifest = JSON.parse(
      await readFile(join(stage, "manifest.json"), "utf8"),
    );
    if (manifest.version !== 1) throw new Error("备份版本不兼容。");
    const restored = join(stage, "installation");
    const filename = join(restored, "domos.config.json");
    const config = JSON.parse(await readFile(filename, "utf8"));
    config.dataDir = join(target, "data");
    if (config.computer.kind === "controller")
      config.computer.credentialFile = join(target, "controller-token");
    if (manifest.work) {
      const controllerFile = join(restored, "controller.json");
      const controller = JSON.parse(await readFile(controllerFile, "utf8"));
      controller.credentialFile = join(target, "controller-token");
      await writeConfiguration(controllerFile, controller);
      work = await workArchive(restored, join(stage, "work.tar"), true);
      if (!work || config.computer.kind !== "controller")
        throw new Error("备份的工作电脑配置不完整。");
      config.computer.id = work.config.id;
      await rm(join(restored, "data/computer.json"), { force: true });
    }
    await writeConfiguration(filename, config);
    await rename(restored, target);
    work = undefined;
  } finally {
    await work?.removeVolume();
    await rm(stage, { recursive: true, force: true });
  }
}
