import { expect, test } from "vitest";
import { WebNetwork } from "../src/computer/web-network.ts";
import { type DockerConfig, parseConfig } from "../src/runtime/config.ts";

test("HTTP egress refuses a changed isolation boundary and requires a healthy proxy", async () => {
  const config = parseConfig(
    {
      computer: {
        kind: "docker",
        id: "test",
        image: "work:test",
        proxyImage: "proxy:test",
        volume: "work-test",
        network: "web",
      },
    },
    "config.json",
  ).computer as DockerConfig;
  const bridge = {
    Internal: true,
    EnableIPv6: false,
    Options: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" },
  };
  const proxy = {
    State: { Running: true, Health: { Status: "healthy" } },
    Config: { Image: config.proxyImage, User: "1000:1000" },
    HostConfig: {
      ReadonlyRootfs: true,
      Privileged: false,
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges:true"],
    },
    NetworkSettings: { Networks: { "test-network": {}, bridge: {} } },
    Mounts: [] as { Type: string; Destination: string }[],
  };
  const command = async (args: readonly string[]) => {
    if (args[1] === "network") return JSON.stringify(bridge);
    if (args[1] === "container") return JSON.stringify(proxy);
    return "";
  };
  const network = new WebNetwork(config, command, "test-network");
  await expect(network.check()).resolves.toBeUndefined();
  bridge.Internal = false;
  await expect(network.check()).rejects.toThrow("隔离网桥");
  bridge.Internal = true;
  bridge.Options["com.docker.network.bridge.gateway_mode_ipv4"] = "nat";
  await expect(network.check()).rejects.toThrow("隔离网桥");
  bridge.Options["com.docker.network.bridge.gateway_mode_ipv4"] = "isolated";
  proxy.State.Health.Status = "unhealthy";
  await expect(network.check()).rejects.toThrow("隔离配置");
  proxy.State.Health.Status = "healthy";
  proxy.Mounts.push({ Type: "bind", Destination: "/control" });
  await expect(network.check()).rejects.toThrow("隔离配置");
  proxy.Mounts.pop();
  proxy.HostConfig.Privileged = true;
  await expect(network.check()).rejects.toThrow("隔离配置");
});
