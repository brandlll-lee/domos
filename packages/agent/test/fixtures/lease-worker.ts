import { acquireDataLease } from "../../src/runtime/lease.ts";

const directory = process.argv[2];
if (!directory) throw new Error("Data directory required");
await acquireDataLease(directory);
process.send?.("ready");
process.on("message", () => {});
