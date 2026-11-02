import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "stdio-fixture", version: "1" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "echo", inputSchema: { type: "object" } }],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: "text", text: process.env.MCP_FIXTURE_TEXT ?? "missing" }],
}));
await server.connect(new StdioServerTransport());
