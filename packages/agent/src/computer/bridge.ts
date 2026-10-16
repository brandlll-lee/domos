import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const [endpoint, id, credentialFile, command, flag, token] =
  process.argv.slice(2);
if (
  !endpoint ||
  !id ||
  !credentialFile ||
  command !== "serve" ||
  flag !== "--token" ||
  !token?.match(/^[a-f0-9]+$/)
)
  throw new Error("工作电脑连接参数无效。");
const url = new URL(endpoint);
const request = (url.protocol === "https:" ? httpsRequest : httpRequest)({
  protocol: url.protocol,
  hostname: url.hostname,
  port: url.port,
  path: `/${encodeURIComponent(id)}/daemon`,
  method: "CONNECT",
  headers: {
    Authorization: `Bearer ${(await readFile(credentialFile, "utf8")).trim()}`,
    "X-Domos-Daemon-Token": token,
  },
});
request.on("connect", (response, socket, head) => {
  if (response.statusCode !== 200) {
    socket.destroy();
    process.exitCode = 1;
    return;
  }
  if (head.length) process.stdout.write(head);
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  socket.on("error", () => {
    process.exitCode = 1;
    socket.destroy();
  });
  socket.once("close", () => process.stdin.destroy());
  process.stdin.on("end", () => socket.end());
});
request.on("error", () => {
  process.exitCode = 1;
});
request.end();
