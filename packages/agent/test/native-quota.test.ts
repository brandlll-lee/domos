import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";

const environmentModule = "../src/harness/account-environment.mjs";
const quotaModule = "../src/harness/native-quota.mjs";
const { accountFingerprint } = await import(environmentModule);
const { antigravityQuota, cursorQuota, devinQuota, readNativeQuota } =
  await import(quotaModule);

afterEach(() => vi.unstubAllGlobals());

const signal = () => new AbortController().signal;
const reset = "2026-11-21T00:00:00Z";

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "domos-quota-test-"));
  onTestFinished(() =>
    rm(path, { recursive: true, force: true, maxRetries: 10 }),
  );
  return path;
}

test("Cursor reads the native login, preserves small percentages and invalidates the account cache", async () => {
  const home = await directory();
  const env = { HOME: home, USERPROFILE: home, CURSOR_CONFIG_DIR: home };
  expect(
    await readNativeQuota("cursor", "cursor-agent", env, signal()),
  ).toMatchObject({ status: "signed-out" });
  const token = `header.${Buffer.from(JSON.stringify({ sub: "auth0|person", exp: Date.now() / 1000 + 3600 })).toString("base64url")}.signature`;
  const fingerprint = await accountFingerprint("cursor", env);
  await writeFile(
    join(home, "auth.json"),
    JSON.stringify({ accessToken: token }),
  );
  expect(await accountFingerprint("cursor", env)).not.toBe(fingerprint);
  const request = vi.fn(async () =>
    Response.json({
      membershipType: "pro",
      billingCycleEnd: reset,
      individualUsage: {
        plan: { totalPercentUsed: 0.36, autoPercentUsed: 0 },
        onDemand: { used: 3, limit: 10 },
      },
    }),
  );
  vi.stubGlobal("fetch", request);
  const data = await readNativeQuota("cursor", "cursor-agent", env, signal());
  expect(data).toMatchObject({
    status: "ready",
    plan: "pro",
    windows: [
      { id: "plan", usedPercent: 0.36, resetsAt: Date.parse(reset) },
      { id: "auto", usedPercent: 0 },
      { id: "on-demand", usedPercent: 30 },
    ],
  });
  expect(request).toHaveBeenCalledWith(
    "https://cursor.com/api/usage-summary",
    expect.objectContaining({
      redirect: "error",
      headers: expect.objectContaining({
        Cookie: `WorkosCursorSessionToken=person%3A%3A${token}`,
      }),
    }),
  );
  expect(JSON.stringify(data)).not.toContain(token);
  expect(cursorQuota({ individualUsage: { plan: { used: 0 } } })).toMatchObject(
    { status: "empty", windows: [] },
  );
  request.mockImplementation(async () => new Response(null, { status: 401 }));
  expect(
    await readNativeQuota("cursor", "cursor-agent", env, signal()),
  ).toMatchObject({ status: "signed-out" });
});

test("Devin scopes web authorization to the supplied organization and keeps hidden or missing limits unknown", async () => {
  const env = {
    DEVIN_AUTHORIZATION: "Bearer test-session",
    DEVIN_ORGANIZATION: "org-example",
  };
  const request = vi.fn(async () =>
    Response.json({
      daily_percentage: 0,
      weekly_percentage: 0.5,
      weekly_reset_at: Date.parse(reset) / 1000,
      plan_name: "pro",
    }),
  );
  vi.stubGlobal("fetch", request);
  expect(await readNativeQuota("devin", "devin", env, signal())).toMatchObject({
    status: "ready",
    accountLabel: "org-example",
    plan: "pro",
    windows: [
      { id: "daily", usedPercent: 0 },
      { id: "weekly", usedPercent: 50, resetsAt: Date.parse(reset) },
    ],
  });
  expect(request).toHaveBeenCalledWith(
    "https://app.devin.ai/api/org-example/billing/quota/usage",
    expect.objectContaining({
      redirect: "error",
      headers: expect.objectContaining({
        Authorization: "Bearer test-session",
        "x-cog-org-id": "org-example",
      }),
    }),
  );
  expect(
    devinQuota(
      { daily_percentage: 0.9, hide_daily_quota: true },
      "org-example",
    ),
  ).toMatchObject({ status: "empty", windows: [] });
  request.mockClear();
  expect(await readNativeQuota("devin", "devin", {}, signal())).toMatchObject({
    status: "signed-out",
  });
  expect(
    await readNativeQuota(
      "devin",
      "devin",
      { ...env, DEVIN_ORGANIZATION: "../other" },
      signal(),
    ),
  ).toMatchObject({ status: "empty" });
  expect(request).not.toHaveBeenCalled();
  request.mockImplementation(
    async () => new Response("x".repeat(1024 * 1024 + 1)),
  );
  expect(await readNativeQuota("devin", "devin", env, signal())).toMatchObject({
    status: "failed",
    message: expect.stringContaining("大小限制"),
  });
  request.mockImplementation(async () => new Response("malformed"));
  expect(await readNativeQuota("devin", "devin", env, signal())).toMatchObject({
    status: "failed",
    message: expect.stringContaining("无效 JSON"),
  });
  request.mockImplementation(async (_url?: unknown, options?: RequestInit) => {
    options?.signal?.throwIfAborted();
    throw new Error("offline");
  });
  const controller = new AbortController();
  controller.abort();
  await expect(
    readNativeQuota("devin", "devin", env, controller.signal),
  ).rejects.toThrow();
});

test("Antigravity accepts only native usage reports and preserves exhausted, missing and disabled buckets", () => {
  const report = {
    status: "SUCCESS",
    num_turns: 0,
    command: {
      name: "usage",
      data: {
        groups: [
          {
            name: "Gemini",
            buckets: [
              {
                id: "weekly",
                name: "每周",
                window: "weekly",
                remaining_fraction: 0.86,
                reset_time: reset,
              },
              {
                id: "short",
                name: "短期",
                window: "5h",
                remaining_fraction: 0,
              },
              { id: "unknown", name: "未知", remaining_fraction: null },
              {
                id: "disabled",
                name: "关闭",
                remaining_fraction: 0,
                disabled: true,
              },
            ],
          },
        ],
      },
    },
  };
  const data = antigravityQuota(report);
  expect(data).toMatchObject({
    status: "ready",
    windows: [
      {
        id: "Gemini:weekly",
        usedPercent: expect.closeTo(14),
        durationMinutes: 10080,
      },
      { id: "Gemini:short", usedPercent: 100, durationMinutes: 300 },
    ],
  });
  expect(() => antigravityQuota({ ...report, num_turns: 1 })).toThrow();
  expect(() =>
    antigravityQuota({ ...report, command: { name: "chat" } }),
  ).toThrow();
});

test("Antigravity executes its usage command outside projects and cancels the owned process", async () => {
  const home = await directory();
  const script = join(home, "quota.mjs");
  const record = join(home, "request.json");
  await writeFile(
    script,
    `
import {writeFileSync} from 'node:fs';
if(process.argv.includes('--version')) console.log('1.5.9');
else {
 writeFileSync(process.env.QUOTA_TEST_RECORD,JSON.stringify({cwd:process.cwd(),pid:process.pid,args:process.argv.slice(2),updates:process.env.AGY_CLI_DISABLE_AUTO_UPDATE}));
 if(process.env.QUOTA_TEST_WAIT) setInterval(()=>{},1000);
 else console.log(JSON.stringify({status:'SUCCESS',num_turns:0,command:{name:'usage',data:{groups:[]}}}));
}
`,
  );
  const command = join(home, process.platform === "win32" ? "agy.cmd" : "agy");
  await writeFile(
    command,
    process.platform === "win32"
      ? `@"${process.execPath}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
  );
  await chmod(command, 0o700);
  const env = { ...process.env, QUOTA_TEST_RECORD: record };
  expect(
    await readNativeQuota("antigravity", command, env, signal()),
  ).toMatchObject({ status: "empty" });
  const request = JSON.parse(await readFile(record, "utf8"));
  expect(request.args).toEqual([
    "-p",
    "/usage",
    "--output-format",
    "json",
    "--settings",
    '{"disableSlashCommands":false}',
    "--print-timeout",
    "20s",
  ]);
  expect(request.updates).toBe("true");
  await expect(stat(request.cwd)).rejects.toThrow();
  await rm(record);
  const controller = new AbortController();
  const pending = readNativeQuota(
    "antigravity",
    command,
    { ...env, QUOTA_TEST_WAIT: "1" },
    controller.signal,
  );
  const settled = pending.catch((error: unknown) => error);
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(record, "utf8").catch(() => "null"))?.pid,
    )
    .toBeTruthy();
  const waiting = JSON.parse(await readFile(record, "utf8"));
  controller.abort();
  expect(await settled).toBeInstanceOf(Error);
  expect(() => process.kill(waiting.pid, 0)).toThrow();
  await expect(stat(waiting.cwd)).rejects.toThrow();
});
