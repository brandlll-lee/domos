import { cp, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { acquireDataLease } from "@domos/agent/lease";
import { z } from "zod";
import { writeConfiguration } from "./install.ts";

const stateSchema = z.object({
  phase: z.enum(["saved", "starting", "restoring", "complete"]),
  target: z.string(),
});

export class StackUpgrade {
  readonly directory: string;
  constructor(private readonly installation: string) {
    this.directory = `${installation}.upgrade`;
  }

  async state() {
    try {
      return stateSchema.parse(
        JSON.parse(await readFile(join(this.directory, "state.json"), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  async phase(
    phase: "saved" | "starting" | "restoring" | "complete",
    target: string,
  ) {
    await writeConfiguration(join(this.directory, "state.json"), {
      phase,
      target,
    });
  }

  async save(target: string) {
    const release = await acquireDataLease(join(this.installation, "data"));
    try {
      await rm(this.directory, { recursive: true, force: true });
      await mkdir(this.directory, { mode: 0o700 });
      await cp(join(this.installation, "data"), join(this.directory, "data"), {
        recursive: true,
        filter: (path) => !/[/\\]runtime\.sqlite(?:-journal)?$/.test(path),
        errorOnExist: true,
      });
      await cp(
        join(this.installation, "compose.json"),
        join(this.directory, "compose.json"),
      );
      await this.phase("saved", target);
    } finally {
      await release();
    }
  }

  async restore() {
    const state = await this.state();
    if (!state) throw new Error("升级快照缺失。");
    await this.phase("restoring", state.target);
    const data = join(this.installation, "data");
    const failed = join(this.directory, "failed-data");
    const restored = join(this.directory, "restore");
    const exists = (path: string) =>
      stat(path).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return false;
        },
      );
    if (!(await exists(failed))) {
      const release = await acquireDataLease(data);
      try {
        await rm(restored, { recursive: true, force: true });
        await cp(join(this.directory, "data"), restored, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      } finally {
        await release();
      }
      await rename(data, failed);
    }
    if (!(await exists(data))) await rename(restored, data);
    await cp(
      join(this.directory, "compose.json"),
      join(this.installation, "compose.json"),
    );
  }
}
