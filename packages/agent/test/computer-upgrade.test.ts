import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { expect, onTestFinished, test, vi } from "vitest";
import { DockerComputer } from "../src/computer/docker.ts";
import { ComputersDoc } from "../src/computer/state.ts";
import { openChat } from "../src/open-chat.ts";
import { computerSchema, parseConfig } from "../src/runtime/config.ts";

test("confirmed work rebuilds use released images and retain computer and volume identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "domos-work-upgrade-"));
  const old = computerSchema.options[1].parse({
    kind: "docker",
    id: "kept",
    volume: "kept-data",
    image: "work:old",
  });
  const config = parseConfig(
    {
      dataDir: directory,
      workComputer: { ...old, image: `registry/work@sha256:${"a".repeat(64)}` },
    },
    join(directory, "config.json"),
  );
  const inspect = vi
    .spyOn(DockerComputer.prototype, "inspect")
    .mockResolvedValue("running");
  const command = vi
    .spyOn(DockerComputer.prototype, "command")
    .mockResolvedValue("cached");
  const rebuilt: string[] = [];
  const rebuild = vi
    .spyOn(DockerComputer.prototype, "rebuild")
    .mockImplementation(async function (this: DockerComputer) {
      rebuilt.push(this.config.image);
    });
  const runtime = await openChat(context, config);
  onTestFinished(async () => {
    await runtime.close();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  await runtime.computer.add({ name: "Work", config: old }, context);
  expect(rebuild).not.toHaveBeenCalled();
  command.mockRejectedValueOnce(new Error("Registry unavailable"));
  await expect(
    runtime.computer.manage(old.id, "rebuild", context),
  ).rejects.toThrow("Registry unavailable");
  expect(rebuild).not.toHaveBeenCalled();
  expect(
    (await runtime.harness.snapshot(ComputersDoc, context))?.items.find(
      (item) => item.id === old.id,
    )?.config,
  ).toEqual(old);
  await runtime.computer.manage(old.id, "rebuild", context);
  expect(rebuilt).toEqual([
    config.workComputer?.kind === "docker" ? config.workComputer.image : "",
  ]);
  expect(
    (await runtime.harness.snapshot(ComputersDoc, context))?.items.find(
      (item) => item.id === old.id,
    )?.config,
  ).toMatchObject({ id: old.id, volume: old.volume, image: rebuilt[0] });
  expect(inspect).toHaveBeenCalled();
});
