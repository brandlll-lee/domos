import { access } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeConfig } from "@domos/agent/config";
import { z } from "zod";
import { runCommand } from "./install.ts";
import { probeInstance, serverOrigin } from "./instance.ts";
import type { HostingStore } from "./store.ts";

export const connectionInput = z.discriminatedUnion("mode", [
  z
    .object({ mode: z.literal("https"), url: z.string().min(1).max(2048) })
    .strict(),
  z.object({ mode: z.literal("tailscale") }).strict(),
  z.object({ mode: z.literal("off") }).strict(),
]);
type SavedConnection = {
  mode: "https" | "tailscale" | "off";
  url?: string;
  managed: boolean;
};
export type TailnetStatus = {
  state:
    | "ready"
    | "missing"
    | "stopped"
    | "login"
    | "approval"
    | "dns"
    | "container"
    | "error";
  message: string;
  url?: string;
};
export type ConnectionStatus = {
  state: "local" | "ready" | "error";
  mode: SavedConnection["mode"];
  url?: string;
  error?: string;
  checkedAt: number;
  tailscale?: TailnetStatus;
};

export class DirectConnection {
  private readonly checking = new Set<string>();
  private busy = false;
  private readonly store: HostingStore;
  private readonly config: RuntimeConfig;
  private readonly computerId: string;

  constructor(store: HostingStore, config: RuntimeConfig, computerId: string) {
    this.store = store;
    this.config = config;
    this.computerId = computerId;
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS connection (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)",
    );
  }

  private saved(): SavedConnection {
    const row = this.store.db
      .prepare("SELECT value FROM connection WHERE id=1")
      .get();
    return row
      ? JSON.parse(String(row.value))
      : {
          mode: this.config.publicUrl?.startsWith("https:") ? "https" : "off",
          url: this.config.publicUrl?.startsWith("https:")
            ? this.config.publicUrl
            : undefined,
          managed: false,
        };
  }

  get origin() {
    return this.saved().url;
  }

  get origins() {
    return [this.origin, ...this.checking].filter((value): value is string =>
      Boolean(value),
    );
  }

  private async cli() {
    if (process.platform === "win32") {
      const filename = join(
        process.env.ProgramFiles ?? "C:\\Program Files",
        "Tailscale",
        "tailscale.exe",
      );
      try {
        await access(filename);
        return filename;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return "tailscale";
  }

  private async command(args: string[], signal?: AbortSignal) {
    return runCommand(await this.cli(), args, { signal, timeout: 15_000 });
  }

  async tailnet(signal?: AbortSignal): Promise<TailnetStatus> {
    if (this.config.deployment === "container")
      return {
        state: "container",
        message:
          "请在宿主机配置 Tailscale HTTPS 转发，再切换到「HTTPS 地址」填写。",
      };
    try {
      const status = JSON.parse(
        await this.command(["status", "--json"], signal),
      );
      if (status.BackendState === "NeedsLogin")
        return {
          state: "login",
          message: "请先在 Tailscale 登录，两台设备需加入同一私有网络。",
        };
      if (status.BackendState === "NeedsMachineAuth")
        return {
          state: "approval",
          message: "请在 Tailscale 管理台批准这台电脑。",
        };
      if (status.BackendState !== "Running")
        return {
          state: "stopped",
          message: "请打开 Tailscale 并连接私有网络。",
        };
      const name = z
        .string()
        .regex(/^[a-z\d][a-z\d.-]*\.ts\.net\.?$/i)
        .safeParse(status.Self?.DNSName);
      if (!status.CurrentTailnet?.MagicDNSEnabled || !name.success)
        return {
          state: "dns",
          message: "请在 Tailscale 管理台启用 MagicDNS 和 HTTPS 证书。",
        };
      const target = new URL(
        this.config.desktopUrl ?? `http://127.0.0.1:${this.config.port}`,
      );
      const port = target.port || (target.protocol === "https:" ? "443" : "80");
      return {
        state: "ready",
        message: "另一台设备也需连接同一 Tailscale 私有网络。",
        url: new URL(`https://${name.data.replace(/\.$/, "")}:${port}`).origin,
      };
    } catch (error) {
      signal?.throwIfAborted();
      const cause = (error as Error & { cause?: NodeJS.ErrnoException }).cause;
      if (cause?.code === "ENOENT")
        return {
          state: "missing",
          message: "在两台设备安装并登录 Tailscale，即可私下连接。",
        };
      return { state: "error", message: this.message(error) };
    }
  }

  private message(error: unknown) {
    const cause = (error as { cause?: { stderr?: string; code?: string } })
      ?.cause;
    return (
      cause?.stderr?.trim().slice(0, 1000) ||
      (error instanceof Error
        ? `${error.message}${cause?.code ? ` (${cause.code})` : ""}`
        : "连接未完成。")
    );
  }

  private async verify(url: string, signal?: AbortSignal) {
    this.checking.add(url);
    try {
      const info = await probeInstance(url, signal);
      if (info.computerId !== this.computerId)
        throw new Error("此地址没有指向当前 Domos。");
    } finally {
      this.checking.delete(url);
    }
  }

  async status(signal?: AbortSignal, detect = true): Promise<ConnectionStatus> {
    const saved = this.saved();
    const result: ConnectionStatus = {
      state: "local",
      mode: saved.mode,
      url: saved.url,
      checkedAt: Date.now(),
    };
    if (saved.url) {
      try {
        await this.verify(saved.url, signal);
        result.state = "ready";
      } catch (error) {
        signal?.throwIfAborted();
        result.state = "error";
        result.error = this.message(error);
      }
    }
    if (detect) result.tailscale = await this.tailnet(signal);
    return result;
  }

  private async serving(port: string, signal?: AbortSignal) {
    const status = JSON.parse(
      await this.command(["serve", "status", "--json"], signal),
    );
    // Foreground sessions can own listeners independently of the background Serve config.
    const occupied = (value: unknown): boolean => {
      if (!value || typeof value !== "object") return false;
      const node = value as Record<string, unknown>;
      return (
        Boolean(node.TCP && typeof node.TCP === "object" && port in node.TCP) ||
        Object.values(node).some(occupied)
      );
    };
    return { status, occupied: occupied(status) };
  }

  private owns(status: Record<string, unknown>, url: string) {
    const target =
      this.config.desktopUrl ?? `http://127.0.0.1:${this.config.port}`;
    const web = status.Web as
      | Record<string, { Handlers?: Record<string, { Proxy?: string }> }>
      | undefined;
    const parsed = new URL(url);
    const host = `${parsed.hostname}:${parsed.port || "443"}`;
    const handlers = web?.[host]?.Handlers;
    const funnel = status.AllowFunnel as Record<string, boolean> | undefined;
    return (
      !funnel?.[host] &&
      handlers &&
      Object.keys(handlers).length === 1 &&
      handlers["/"]?.Proxy === target
    );
  }

  async configure(
    input: z.infer<typeof connectionInput>,
    signal?: AbortSignal,
  ) {
    if (this.busy) throw new Error("正在配置连接，请稍后重试。");
    this.busy = true;
    let created: string | undefined;
    let stopped: string | undefined;
    try {
      const previous = this.saved();
      let next: SavedConnection = { mode: input.mode, managed: false };
      if (input.mode === "https") {
        const parsed = new URL(input.url);
        if (parsed.protocol !== "https:" || parsed.pathname !== "/")
          throw new Error("请输入完整的 HTTPS 地址，不含路径、参数或配对码。");
        next.url = serverOrigin(input.url);
      } else if (input.mode === "tailscale") {
        const tailnet = await this.tailnet(signal);
        if (tailnet.state !== "ready" || !tailnet.url)
          throw new Error(tailnet.message);
        next = { mode: "tailscale", url: tailnet.url, managed: true };
        const port = new URL(tailnet.url).port || "443";
        const serve = await this.serving(port, signal);
        if (
          (serve.status.AllowFunnel as Record<string, boolean> | undefined)?.[
            `${new URL(tailnet.url).hostname}:${port}`
          ]
        )
          throw new Error(
            "此 Tailscale 地址已启用公网访问。请先关闭该地址的 Funnel，再启用私有连接。",
          );
        if (serve.occupied) {
          if (!this.owns(serve.status, tailnet.url))
            throw new Error(
              `Tailscale 的 ${port} 端口已用于其他服务。请使用手动 HTTPS 地址。`,
            );
          next.managed = previous.url === tailnet.url && previous.managed;
        } else {
          created = tailnet.url;
          await this.command(
            [
              "serve",
              "--bg",
              "--yes",
              `--https=${port}`,
              this.config.desktopUrl ?? `http://127.0.0.1:${this.config.port}`,
            ],
            signal,
          );
        }
      }
      if (next.url === previous.url) next.managed = previous.managed;
      if (next.url) await this.verify(next.url, signal);
      if (previous.managed && previous.url && previous.url !== next.url) {
        const port = new URL(previous.url).port || "443";
        const serve = await this.serving(port, signal);
        if (this.owns(serve.status, previous.url)) {
          stopped = previous.url;
          await this.command(["serve", `--https=${port}`, "off"], signal);
        }
      }
      signal?.throwIfAborted();
      await this.store.transact(async () => {
        signal?.throwIfAborted();
        this.store.db
          .prepare(
            "INSERT INTO connection(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
          )
          .run(JSON.stringify(next));
        this.store.db.exec("DELETE FROM pairings");
      });
      created = undefined;
      stopped = undefined;
      return {
        state: next.url ? "ready" : "local",
        mode: next.mode,
        url: next.url,
        checkedAt: Date.now(),
        tailscale: await this.tailnet(),
      } as ConnectionStatus;
    } catch (error) {
      if (stopped)
        await this.command([
          "serve",
          "--bg",
          "--yes",
          `--https=${new URL(stopped).port || "443"}`,
          this.config.desktopUrl ?? `http://127.0.0.1:${this.config.port}`,
        ]);
      if (created) {
        const port = new URL(created).port || "443";
        const serve = await this.serving(port);
        if (this.owns(serve.status, created))
          await this.command(["serve", `--https=${port}`, "off"]);
      }
      throw new Error(this.message(error));
    } finally {
      this.busy = false;
    }
  }
}
