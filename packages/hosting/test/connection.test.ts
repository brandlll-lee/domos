import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "@domos/agent/config";
import { expect, onTestFinished, test, vi } from "vitest";
import { DirectConnection } from "../src/connection.ts";
import * as installation from "../src/install.ts";
import { Sessions } from "../src/sessions.ts";
import { HostingStore } from "../src/store.ts";

const running = {
  BackendState: "Running",
  Self: { DNSName: "home.example.ts.net." },
  CurrentTailnet: { MagicDNSEnabled: true },
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "domos-direct-"));
  const store = await HostingStore.open(directory);
  const config = parseConfig(
    { dataDir: directory, publicUrl: "https://old.example.com" },
    join(directory, "config.json"),
  );
  const connection = new DirectConnection(store, config, "home");
  const command = vi.spyOn(installation, "runCommand");
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () =>
      Response.json({ product: "domos", version: "1", computerId: "home" }),
    );
  onTestFinished(async () => {
    vi.restoreAllMocks();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { connection, store, config, command, fetcher };
}

test("Tailscale detection distinguishes setup states and does not start services", async () => {
  const { connection, command, config } = await fixture();
  command.mockRejectedValueOnce(
    new Error("spawn", { cause: { code: "ENOENT" } }),
  );
  expect((await connection.tailnet()).state).toBe("missing");
  for (const [status, state] of [
    [{ BackendState: "Stopped" }, "stopped"],
    [{ BackendState: "NeedsLogin" }, "login"],
    [{ BackendState: "NeedsMachineAuth" }, "approval"],
    [{ ...running, CurrentTailnet: { MagicDNSEnabled: false } }, "dns"],
    [running, "ready"],
  ] as const) {
    command.mockResolvedValueOnce(JSON.stringify(status));
    expect((await connection.tailnet()).state).toBe(state);
  }
  expect(
    command.mock.calls.every(([, args]) => args.join(" ") === "status --json"),
  ).toBe(true);
  config.port = 443;
  command.mockResolvedValueOnce(JSON.stringify(running));
  expect((await connection.tailnet()).url).toBe("https://home.example.ts.net");
  config.deployment = "container";
  command.mockClear();
  expect((await connection.tailnet()).state).toBe("container");
  expect(command).not.toHaveBeenCalled();
});

test("manual HTTPS validates identity before saving and preserves grants across restart and failed changes", async () => {
  const { connection, store, config, command, fetcher } = await fixture();
  command.mockRejectedValue(new Error("spawn", { cause: { code: "ENOENT" } }));
  const sessions = new Sessions(store);
  const owner = sessions.exchange(sessions.pairing("admin").code, "Owner");
  if (!owner) throw new Error("Owner required");
  const code = sessions.pairing("client").code;
  for (const url of [
    "http://100.64.0.1:4310",
    "https://home.test/path",
    "https://home.test?pair=x",
    "https://user:pass@home.test",
    "https://home.test/#pair=x",
  ])
    await expect(
      connection.configure({ mode: "https", url }),
    ).rejects.toThrow();
  fetcher.mockResolvedValueOnce(
    Response.json({ product: "domos", version: "1", computerId: "another" }),
  );
  await expect(
    connection.configure({ mode: "https", url: "https://wrong.test" }),
  ).rejects.toThrow("没有指向");
  expect(connection.origin).toBe("https://old.example.com");
  expect(sessions.exchange(code, "Still valid")).toBeDefined();
  expect(
    (await connection.configure({ mode: "https", url: "https://home.test/" }))
      .state,
  ).toBe("ready");
  expect(new DirectConnection(store, config, "home").origin).toBe(
    "https://home.test",
  );
  fetcher.mockRejectedValueOnce(new Error("certificate has expired"));
  await expect(
    connection.configure({ mode: "https", url: "https://expired.test" }),
  ).rejects.toThrow("certificate");
  expect(connection.origin).toBe("https://home.test");
  expect(sessions.authenticate(owner.token)).toBeDefined();
  await connection.configure({ mode: "off" });
  expect(new DirectConnection(store, config, "home").origin).toBeUndefined();
  expect(sessions.authenticate(owner.token)).toBeDefined();
});

test("Tailscale setup owns only its listener and rolls back a failed probe", async () => {
  const { connection, command, fetcher } = await fixture();
  const url = "https://home.example.ts.net:4310";
  const active = {
    TCP: { "4310": { HTTPS: true } },
    Web: {
      "home.example.ts.net:4310": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:4310" } },
      },
    },
  };
  let serving = false;
  command.mockImplementation(async (_program, args) => {
    if (args[0] === "status") return JSON.stringify(running);
    if (args[1] === "status") return JSON.stringify(serving ? active : {});
    serving = args.includes("--bg");
    return "";
  });
  fetcher.mockRejectedValueOnce(new Error("TLS failed"));
  await expect(connection.configure({ mode: "tailscale" })).rejects.toThrow(
    "TLS failed",
  );
  expect(serving).toBe(false);
  expect(connection.origin).toBe("https://old.example.com");
  expect((await connection.configure({ mode: "tailscale" })).url).toBe(url);
  expect(serving).toBe(true);
  command.mockClear();
  await connection.configure({ mode: "tailscale" });
  expect(command.mock.calls.some(([, args]) => args.includes("--bg"))).toBe(
    false,
  );
  await connection.configure({ mode: "https", url });
  await connection.configure({ mode: "off" });
  expect(serving).toBe(false);
  expect(command.mock.calls.some(([, args]) => args.includes("reset"))).toBe(
    false,
  );
});

test("Tailscale refuses occupied and public listeners and leaves user-owned routes intact", async () => {
  const { connection, command } = await fixture();
  let serve: unknown = {
    Foreground: { session: { TCP: { "4310": { HTTPS: true } } } },
  };
  command.mockImplementation(async (_program, args) =>
    JSON.stringify(args[0] === "status" ? running : serve),
  );
  await expect(connection.configure({ mode: "tailscale" })).rejects.toThrow(
    "其他服务",
  );
  serve = { AllowFunnel: { "home.example.ts.net:4310": true } };
  await expect(connection.configure({ mode: "tailscale" })).rejects.toThrow(
    "公网",
  );
  serve = {
    TCP: { "4310": { HTTPS: true } },
    Web: {
      "home.example.ts.net:4310": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:4310" } },
      },
    },
  };
  await connection.configure({ mode: "tailscale" });
  await connection.configure({ mode: "off" });
  expect(
    command.mock.calls.every(
      ([, args]) => args[0] === "status" || args[1] === "status",
    ),
  ).toBe(true);
});
