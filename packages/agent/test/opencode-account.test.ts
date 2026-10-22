import { expect, test } from "vitest";
import { openOpenCodeAccount } from "../src/harness/opencode-account.ts";
import { ProtocolProcess } from "./fixtures/engine-process.ts";

function fixture() {
  const worker = new ProtocolProcess();
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  worker.request = async <T>(path: string, method?: string, body?: unknown) => {
    calls.push({ path, method, body });
    const value =
      path === "/provider"
        ? {
            all: [
              {
                id: "first",
                name: "First",
                models: { one: { id: "one", name: "One" } },
              },
              {
                id: "second",
                name: "Second",
                models: { two: { id: "two", name: "Two" } },
              },
            ],
            connected: ["second"],
          }
        : path === "/provider/auth"
          ? {
              first: [
                { type: "oauth", label: "Sign in" },
                { type: "api", label: "Key" },
              ],
            }
          : path.endsWith("/authorize")
            ? {
                url: "https://example.com/authorize",
                method: "code",
                instructions: "Paste code",
              }
            : true;
    return value as T;
  };
  return { worker, calls };
}

test("uses the native connected providers and models in the private account directory", async () => {
  const { worker } = fixture();
  const account = await openOpenCodeAccount(worker);
  expect(worker.spec).toMatchObject({
    command: "opencode",
    env: {
      XDG_DATA_HOME: "/work/accounts/opencode/data",
      XDG_CONFIG_HOME: "/work/accounts/opencode/config",
    },
  });
  expect(await account.catalog()).toMatchObject({
    authenticated: true,
    models: [{ id: "second/two", name: "Two" }],
    providers: [
      {
        id: "first",
        connected: false,
        methods: [{ type: "oauth" }, { type: "api" }],
      },
      { id: "second", connected: true, methods: [{ type: "api" }] },
    ],
  });
  expect((await account.catalog("first/one")).authenticated).toBe(false);
});

test("keeps authorization and code completion on the same native process", async () => {
  const { worker, calls } = fixture();
  const account = await openOpenCodeAccount(worker);
  await expect(account.login("first", 0)).resolves.toMatchObject({
    method: "code",
  });
  await account.complete("first", 0, "fixture-code");
  expect(calls.slice(-2)).toEqual([
    {
      path: "/provider/first/oauth/authorize",
      method: "POST",
      body: { method: 0, inputs: undefined },
    },
    {
      path: "/provider/first/oauth/callback",
      method: "POST",
      body: { method: 0, code: "fixture-code" },
    },
  ]);
});

test("native OpenCode discovery uses the work computer configuration", async () => {
  const { worker } = fixture();
  const account = await openOpenCodeAccount(worker, {}, "native");
  expect((await account.catalog()).models).toMatchObject([
    { id: "second/two", name: "Two" },
  ]);
  expect(worker.spec).toMatchObject({ accountSource: "native" });
  expect(worker.spec?.env).not.toHaveProperty("XDG_DATA_HOME");
  expect(worker.spec?.env).not.toHaveProperty("XDG_CONFIG_HOME");
});

test("rejects unknown providers and methods before sending an authorization request", async () => {
  const { worker, calls } = fixture();
  const account = await openOpenCodeAccount(worker);
  await expect(account.login("missing", 0)).rejects.toThrow("服务商不可用");
  await expect(account.login("first", 1)).rejects.toThrow("连接方式不可用");
  expect(calls.some((item) => item.path.endsWith("/authorize"))).toBe(false);
});

test("sets and removes the chosen provider key through the native API", async () => {
  const { worker, calls } = fixture();
  const account = await openOpenCodeAccount(worker);
  await account.key("first", "fixture-key");
  await account.key("first", null);
  expect(calls.filter((item) => item.path.startsWith("/auth/"))).toEqual([
    {
      path: "/auth/first",
      method: "PUT",
      body: { type: "api", key: "fixture-key" },
    },
    { path: "/auth/first", method: "DELETE", body: undefined },
  ]);
});
