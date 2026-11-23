import { parentPort, workerData } from "node:worker_threads";
import { compactDatabase } from "@domos/agent/maintenance";

if (typeof workerData !== "string") throw new Error("数据库路径无效。");
parentPort?.postMessage(await compactDatabase(workerData));
