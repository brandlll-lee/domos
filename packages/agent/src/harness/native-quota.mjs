import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import spawn from "cross-spawn";
import { z } from "zod";

const amount = z.number().finite().nonnegative();
const percent = z.number().finite().nonnegative();
const date = z
  .union([z.iso.datetime({ offset: true }), z.number().positive().finite()])
  .nullish();
const optionalAmount = amount.nullish();

export function quotaAccountFiles(provider, env) {
  const user = env.HOME || env.USERPROFILE || homedir();
  if (provider === "cursor")
    return [
      join(
        env.CURSOR_CONFIG_DIR ||
          env.APPDATA ||
          env.XDG_CONFIG_HOME ||
          join(user, ".config"),
        ...(env.CURSOR_CONFIG_DIR ? [] : ["cursor"]),
        "auth.json",
      ),
    ];
  return [];
}

function result(source, windows, extra = {}) {
  return {
    source,
    observedAt: Date.now(),
    status: windows.length ? "ready" : "empty",
    windows,
    ...extra,
  };
}

function window(id, name, usedPercent, resetsAt, durationMinutes = null) {
  return {
    id,
    name,
    usedPercent: Math.min(100, usedPercent),
    resetsAt:
      typeof resetsAt === "number"
        ? resetsAt * (resetsAt < 10_000_000_000 ? 1000 : 1)
        : resetsAt
          ? Date.parse(resetsAt)
          : null,
    durationMinutes,
  };
}

export function cursorQuota(payload) {
  const cap = z.object({
    enabled: z.boolean().optional(),
    used: optionalAmount,
    limit: optionalAmount,
    totalPercentUsed: percent.nullish(),
    autoPercentUsed: percent.nullish(),
    apiPercentUsed: percent.nullish(),
  });
  const data = z
    .object({
      billingCycleStart: date,
      billingCycleEnd: date,
      membershipType: z.string().nullish(),
      individualUsage: z
        .object({
          plan: cap.nullish(),
          overall: cap.nullish(),
          onDemand: cap.nullish(),
        })
        .nullish(),
    })
    .parse(payload);
  const windows = [];
  const add = (id, name, value) => {
    if (!value || value.enabled === false) return;
    const used =
      value.totalPercentUsed ??
      (value.used != null && value.limit > 0
        ? (value.used / value.limit) * 100
        : null);
    if (used !== null)
      windows.push(window(id, name, used, data.billingCycleEnd));
  };
  const plan = data.individualUsage?.plan;
  add("plan", "套餐额度", plan);
  if (!windows.length)
    add("overall", "个人额度", data.individualUsage?.overall);
  for (const [id, name, value] of [
    ["auto", "Auto 模型", plan?.autoPercentUsed],
    ["api", "按需模型", plan?.apiPercentUsed],
  ])
    if (value != null && plan.enabled !== false)
      windows.push(window(id, name, value, data.billingCycleEnd));
  add("on-demand", "额外用量额度", data.individualUsage?.onDemand);
  return result(
    "cursor.api/usage-summary",
    windows,
    data.membershipType ? { plan: data.membershipType } : {},
  );
}

export function devinQuota(payload, organization) {
  const data = z
    .object({
      daily_percentage: percent.nullish(),
      daily_reset_at: date,
      weekly_percentage: percent.nullish(),
      weekly_reset_at: date,
      hide_daily_quota: z.boolean().optional(),
      plan_name: z.string().nullish(),
    })
    .parse(payload);
  const windows = [];
  for (const [id, name, value, reset, minutes] of [
    [
      "daily",
      "每日额度",
      data.hide_daily_quota ? null : data.daily_percentage,
      data.daily_reset_at,
      1440,
    ],
    ["weekly", "每周额度", data.weekly_percentage, data.weekly_reset_at, 10080],
  ]) {
    // Devin's quota endpoint encodes fractional utilization below one.
    if (value != null)
      windows.push(
        window(id, name, value < 1 ? value * 100 : value, reset, minutes),
      );
  }
  return result("devin.billing/quota/usage", windows, {
    accountLabel: organization,
    ...(data.plan_name ? { plan: data.plan_name } : {}),
  });
}

export function antigravityQuota(payload) {
  const data = z
    .object({
      status: z.literal("SUCCESS"),
      num_turns: z.literal(0).optional(),
      command: z.object({
        name: z.literal("usage"),
        data: z.object({
          groups: z.array(
            z.object({
              name: z.string(),
              buckets: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  disabled: z.boolean().optional(),
                  remaining_fraction: z.number().min(0).max(1).nullish(),
                  reset_time: date,
                  window: z.string().optional(),
                }),
              ),
            }),
          ),
        }),
      }),
    })
    .parse(payload);
  return result(
    "antigravity.cli/usage",
    data.command.data.groups.flatMap((group) =>
      group.buckets.flatMap((bucket) =>
        bucket.disabled || bucket.remaining_fraction == null
          ? []
          : [
              window(
                `${group.name}:${bucket.id}`,
                `${group.name} · ${bucket.name}`,
                (1 - bucket.remaining_fraction) * 100,
                bucket.reset_time,
                bucket.window === "weekly"
                  ? 10080
                  : bucket.window === "5h"
                    ? 300
                    : null,
              ),
            ],
      ),
    ),
  );
}

async function jsonRequest(url, headers, signal) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    redirect: "error",
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw Object.assign(new Error("账号登录已失效或没有读取权限。"), {
      code: "AUTH",
    });
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`额度服务返回 HTTP ${response.status}。`);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error("额度响应超过大小限制。");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("额度服务返回了无效 JSON。");
  }
}

async function cursorAccount(env) {
  if (env.CURSOR_AUTH_TOKEN?.trim()) return env.CURSOR_AUTH_TOKEN.trim();
  const path = quotaAccountFiles("cursor", env)[0];
  const content = await readFile(path).catch((error) => {
    if (error.code !== "ENOENT") throw new Error("Cursor 登录配置无法读取。");
  });
  if (!content) return null;
  try {
    return (
      z
        .object({ accessToken: z.string().optional() })
        .parse(JSON.parse(content)).accessToken ?? null
    );
  } catch {
    throw new Error("Cursor 登录配置格式无效。");
  }
}

async function cursor(env, signal) {
  const token = await cursorAccount(env);
  if (!token)
    return result("cursor.api/usage-summary", [], {
      status: "signed-out",
      message: "请先在当前电脑运行 cursor-agent login 登录。",
    });
  let identity;
  try {
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error();
    identity = z
      .object({ sub: z.string(), exp: amount })
      .parse(
        JSON.parse(
          Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
        ),
      );
  } catch {
    throw new Error("Cursor 登录凭据格式无效。请重新登录。");
  }
  if (identity.exp * 1000 <= Date.now() + 60_000)
    return result("cursor.api/usage-summary", [], {
      status: "signed-out",
      message: "Cursor 登录已过期。请重新登录。",
    });
  const user = identity.sub.split("|").at(-1);
  if (!/^[\w.-]+$/.test(user)) throw new Error("Cursor 账号标识无效。");
  return cursorQuota(
    await jsonRequest(
      "https://cursor.com/api/usage-summary",
      { Cookie: `WorkosCursorSessionToken=${user}%3A%3A${token}` },
      signal,
    ),
  );
}

async function devin(env, signal) {
  const token = (env.DEVIN_BEARER_TOKEN ?? env.DEVIN_AUTHORIZATION)
    ?.trim()
    .replace(/^Authorization:\s*/i, "")
    .replace(/^Bearer\s+/i, "");
  const organization = (env.DEVIN_ORGANIZATION ?? env.DEVIN_ORG)?.trim();
  if (!token)
    return result("devin.billing/quota/usage", [], {
      status: "signed-out",
      message:
        "需要 Devin 网页会话授权。请在工作电脑配置 DEVIN_BEARER_TOKEN 和 DEVIN_ORGANIZATION；CLI 登录凭据不能替代网页会话。",
    });
  if (!organization || !/^org[-_][\w-]+$/.test(organization))
    return result("devin.billing/quota/usage", [], {
      status: "empty",
      message:
        "请通过 DEVIN_ORGANIZATION 指定 Devin Usage & Limits 页面的组织 ID（org- 或 org_ 开头）。",
    });
  return devinQuota(
    await jsonRequest(
      `https://app.devin.ai/api/${encodeURIComponent(organization)}/billing/quota/usage`,
      {
        Authorization: `Bearer ${token}`,
        "x-cog-org-id": organization,
      },
      signal,
    ),
    organization,
  );
}

async function commandOutput(command, args, env, cwd, signal) {
  signal.throwIfAborted();
  const child = spawn(command, args, {
    env,
    cwd,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "",
    overflow = false;
  let stopping;
  const stop = () =>
    (stopping ??= (async () => {
      if (
        !child.pid ||
        (process.platform === "win32" && child.exitCode !== null)
      )
        return;
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        await once(killer, "close");
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    })());
  const abort = () => {
    void stop().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  child.stdout.on("data", (data) => {
    if (overflow) return;
    stdout += data.toString();
    if (Buffer.byteLength(stdout) > 1024 * 1024) {
      overflow = true;
      abort();
    }
  });
  child.stderr.on("data", (data) => {
    stderr = (stderr + data.toString()).slice(-4096);
  });
  try {
    const [code] = await once(child, "close");
    signal.throwIfAborted();
    if (overflow) throw new Error("Antigravity 额度响应超过大小限制。");
    if (code !== 0)
      throw Object.assign(
        new Error("Antigravity 额度命令未完成。请检查 CLI 登录状态。"),
        {
          code: /authentication required|not logged in|sign.in|unauthenticated/i.test(
            stderr,
          )
            ? "AUTH"
            : "CLI",
        },
      );
    return stdout;
  } finally {
    signal.removeEventListener("abort", abort);
    await stop();
  }
}

async function antigravity(command, env, signal) {
  const directory = await mkdtemp(join(tmpdir(), "domos-quota-"));
  try {
    // Quota refresh must not run project instructions or open an OAuth browser.
    const bin = join(directory, "bin");
    await mkdir(bin);
    for (const name of process.platform === "win32"
      ? ["open.cmd", "xdg-open.cmd", "start.cmd"]
      : ["open", "xdg-open"])
      await writeFile(
        join(bin, name),
        process.platform === "win32" ? "@exit /b 1\r\n" : "#!/bin/sh\nexit 1\n",
        { mode: 0o700 },
      );
    const pathKey =
      Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    const scoped = {
      ...env,
      [pathKey]: `${bin}${delimiter}${env[pathKey] ?? ""}`,
      BROWSER: join(bin, process.platform === "win32" ? "open.cmd" : "open"),
      AGY_CLI_DISABLE_AUTO_UPDATE: "true",
      NO_OPEN_BROWSER: "1",
      CI: "1",
    };
    const version = (
      await commandOutput(command, ["--version"], scoped, directory, signal)
    ).match(/(\d+)\.(\d+)\.(\d+)/);
    if (
      !version ||
      Number(version[1]) < 1 ||
      (Number(version[1]) === 1 && Number(version[2]) < 1) ||
      (Number(version[1]) === 1 &&
        Number(version[2]) === 1 &&
        Number(version[3]) < 11)
    )
      return result("antigravity.cli/usage", [], {
        status: "unsupported",
        message: "请将 Antigravity CLI 更新至 1.1.11 或更高版本。",
      });
    const output = await commandOutput(
      command,
      [
        "-p",
        "/usage",
        "--output-format",
        "json",
        "--settings",
        '{"disableSlashCommands":false}',
        "--print-timeout",
        "20s",
      ],
      scoped,
      directory,
      signal,
    );
    return antigravityQuota(JSON.parse(output));
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}

export async function readNativeQuota(provider, command, env, signal) {
  if (!["cursor", "antigravity", "devin"].includes(provider))
    throw new Error("此引擎未提供账号额度读取。");
  const source = {
    cursor: "cursor.api/usage-summary",
    antigravity: "antigravity.cli/usage",
    devin: "devin.billing/quota/usage",
  }[provider];
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  try {
    return await (provider === "cursor"
      ? cursor(env, bounded)
      : provider === "devin"
        ? devin(env, bounded)
        : antigravity(command, env, bounded));
  } catch (error) {
    signal.throwIfAborted();
    return result(source, [], {
      status: error.code === "AUTH" ? "signed-out" : "failed",
      message: bounded.aborted
        ? "额度读取超时，请稍后刷新。"
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? "额度数据格式未能识别。"
          : error.message,
    });
  }
}
