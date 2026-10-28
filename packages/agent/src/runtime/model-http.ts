import { EventEmitter } from "node:events";
import {
  Client,
  type Dispatcher,
  EnvHttpProxyAgent,
  install,
  Pool,
  setGlobalDispatcher,
} from "undici";

let configured = false;

// Undici emits dispatcher errors as well as rejecting the request and its response stream.
function observe<T extends Dispatcher>(dispatcher: T): T {
  EventEmitter.prototype.on.call(dispatcher, "error", () => {});
  return dispatcher;
}

export function configureModelHttp() {
  if (configured) return;
  const client = (origin: string | URL, options: Client.Options) =>
    observe(new Client(origin, options));
  const dispatcher = observe(
    new EnvHttpProxyAgent({
      allowH2: false,
      proxyTunnel: true,
      bodyTimeout: 300_000,
      headersTimeout: 300_000,
      connect: { autoSelectFamilyAttemptTimeout: 2_000 },
      clientFactory: client,
      factory: (origin, options) => {
        const pool = options as Pool.Options;
        return pool.connections === 1
          ? client(origin, pool)
          : observe(new Pool(origin, { ...pool, factory: client }));
      },
    }),
  );
  setGlobalDispatcher(dispatcher);
  install();
  configured = true;
}
