import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const clients = [];
const connection = new AgentSideConnection(
  () => ({
    async initialize() {
      return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} };
    },
    async newSession({ mcpServers }) {
      for (const server of mcpServers) {
        const client = new Client({ name: "stdio-fixture", version: "1" });
        await client.connect(
          new StdioClientTransport({
            command: server.command,
            args: server.args,
            env: Object.fromEntries(
              server.env.map(({ name, value }) => [name, value]),
            ),
            stderr: "inherit",
          }),
        );
        clients.push(client);
      }
      return { sessionId: "stdio-session" };
    },
    async prompt({ sessionId }) {
      const results = [];
      for (const client of clients) {
        const { tools } = await client.listTools();
        results.push(
          await client.callTool({
            name: tools[0].name,
            arguments: { text: "stdio" },
          }),
        );
      }
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: JSON.stringify(results) },
        },
      });
      return { stopReason: "end_turn" };
    },
    async cancel() {},
  }),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
process.stdin.once("end", () => {
  void Promise.all(clients.map((client) => client.close()));
});
