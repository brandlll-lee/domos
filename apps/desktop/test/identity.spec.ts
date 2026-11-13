import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

test("Windows distribution retains its profile and exposes the Domos executable icon", async ({
  playwright,
}) => {
  test.skip(process.platform !== "win32");
  const directory = await mkdtemp(join(tmpdir(), "domos-identity-"));
  const executablePath = resolve("apps/desktop/release/win-unpacked/Domos.exe");
  const script = join(directory, "icon.ps1");
  await writeFile(
    script,
    `param([string]$Target)
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($Target)
$stream = New-Object System.IO.MemoryStream
$icon.ToBitmap().Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
[Convert]::ToBase64String($stream.ToArray())
$stream.Dispose()
$icon.Dispose()
`,
  );
  const { stdout } = await promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      script,
      "-Target",
      executablePath,
    ],
    { windowsHide: true },
  );
  const desktop = await playwright._electron.launch({
    executablePath,
    args: [`--user-data-dir=${directory}`],
  });
  try {
    const window = await desktop.firstWindow();
    await expect(
      window.getByRole("heading", { name: "认识一下 Domos" }),
    ).toBeVisible();
    const identity = await desktop.evaluate(
      async ({ app, nativeImage, shell }, { directory, embedded }) => {
        const icon = nativeImage
          .createFromBuffer(Buffer.from(embedded, "base64"))
          .resize({ width: 32, height: 32 });
        const expected = nativeImage
          .createFromPath(`${app.getAppPath()}/dist/icon.png`)
          .resize(icon.getSize());
        const actualPixels = icon.toBitmap();
        const expectedPixels = expected.toBitmap();
        let difference = 0;
        for (let i = 0; i < actualPixels.length; i++)
          difference += Math.abs(
            (actualPixels[i] ?? 0) - (expectedPixels[i] ?? 0),
          );
        const shortcut = `${directory}/Domos.lnk`;
        if (
          !shell.writeShortcutLink(shortcut, {
            target: process.execPath,
            icon: process.execPath,
            iconIndex: 0,
            appUserModelId: "app.domos.desktop",
          })
        )
          throw new Error("Shortcut required");
        const link = shell.readShortcutLink(shortcut);
        return {
          packaged: app.isPackaged,
          profile: app.getPath("userData"),
          size: icon.getSize(),
          difference: difference / actualPixels.length,
          target: link.target,
          id: link.appUserModelId,
        };
      },
      { directory, embedded: stdout.trim() },
    );
    expect(identity.packaged).toBe(true);
    expect(identity.profile).toBe(directory);
    expect(identity.size.width).toBeGreaterThan(0);
    expect(identity.difference).toBeLessThan(25);
    expect(identity.target.toLowerCase()).toBe(executablePath.toLowerCase());
    expect(identity.id).toBe("app.domos.desktop");
    const handle = await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]
        ?.getNativeWindowHandle()
        .readBigUInt64LE()
        .toString(),
    );
    if (!handle) throw new Error("Native window required");
    const properties = await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        resolve("apps/desktop/test/fixtures/window-identity.ps1"),
        "-Window",
        handle,
      ],
      { windowsHide: true },
    );
    const taskbar = JSON.parse(properties.stdout);
    expect(taskbar.appId).toBe("app.domos.desktop");
    const iconPath = resolve(
      "apps/desktop/release/win-unpacked/resources/icon.ico",
    );
    expect(taskbar.icon).toBe(`${iconPath},0`);
    expect(await readFile(iconPath)).toEqual(
      await readFile(resolve("packages/ui/assets/icon.ico")),
    );
    expect(taskbar.command.toLowerCase()).toBe(
      `"${executablePath.toLowerCase()}"`,
    );
    expect(taskbar.name).toBe("Domos");
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});
