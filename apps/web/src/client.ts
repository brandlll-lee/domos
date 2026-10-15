import type { AppRouter } from "@domos/api";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import {
  ClientRetryPlugin,
  type ClientRetryPluginContext,
} from "@orpc/client/plugins";
import type { RouterClient } from "@orpc/server";

const link = new RPCLink<ClientRetryPluginContext>({
  url: new URL("/rpc", window.location.origin),
  plugins: [new ClientRetryPlugin()],
});

export const client: RouterClient<AppRouter, ClientRetryPluginContext> =
  createORPCClient(link);
