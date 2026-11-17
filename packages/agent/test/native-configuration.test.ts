import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, onTestFinished, test } from "vitest";

const nativeConfiguration = "../src/harness/native-configuration.mjs";
const { nativeMcpFiles, nativeMcpCatalog, antigravityMcpCatalog } =
  await import(nativeConfiguration);

test.each(["cursor", "devin"])(
  "%s reads native MCP layers without publishing credentials or claiming connections",
  async (provider) => {
    const root = await mkdtemp(join(tmpdir(), "domos-native-catalog-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const env = {
      HOME: join(root, "account"),
      APPDATA: join(root, "account", "AppData"),
    };
    const cwd = join(root, "project");
    const files = nativeMcpFiles(provider, env, cwd);
    for (const path of files) await mkdir(dirname(path), { recursive: true });
    await writeFile(
      files[0],
      '{ // Native configuration\n"mcpServers": {"docs": {"env": {"TOKEN": "private"}}, "paused": {"disabled": true},},}',
    );
    await writeFile(files.at(-1), '{"mcpServers":{"docs":{"disabled":true}}}');
    const catalog = await nativeMcpCatalog(provider, env, cwd);
    expect(catalog.status).toBe("complete");
    expect(catalog.items).toHaveLength(2);
    expect(
      catalog.items.find((item: { name: string }) => item.name === "docs"),
    ).toMatchObject({
      enabled: false,
      status: "unknown",
      source: files.at(-1),
    });
    expect(JSON.stringify(catalog)).not.toContain("private");
    await writeFile(files[0], '{"mcpServers":');
    expect((await nativeMcpCatalog(provider, env, cwd)).status).toBe("partial");
  },
);

test("Antigravity uses its native MCP catalog and removes command credentials at the work boundary", () => {
  const result = antigravityMcpCatalog(
    "NAME TYPE STATUS COMMAND/URL\ndocs http enabled https://example.test/mcp?key=private\nlocal stdio disabled node server.js --token private\n",
  );
  expect(result).toEqual([
    {
      name: "docs",
      source: "Antigravity CLI",
      enabled: true,
      status: "unknown",
    },
    {
      name: "local",
      source: "Antigravity CLI",
      enabled: false,
      status: "unknown",
    },
  ]);
  expect(JSON.stringify(result)).not.toContain("private");
  expect(() => antigravityMcpCatalog("Unknown output")).toThrow("目录");
});

test("Antigravity session identity changes with native CLI settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "domos-native-account-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const module = "../src/harness/account-environment.mjs";
  const { accountFingerprint } = await import(module);
  const env = { HOME: root };
  const initial = await accountFingerprint("antigravity", env);
  const directory = join(root, ".gemini", "antigravity-cli");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "settings.json"), '{"model":"native-model"}');
  expect(await accountFingerprint("antigravity", env)).not.toBe(initial);
});
