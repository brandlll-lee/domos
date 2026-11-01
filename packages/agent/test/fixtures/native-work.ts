export const codexWork = [
  {
    id: "search",
    type: "webSearch",
    query: "example assets",
    action: {
      type: "search",
      queries: ["example assets", "example assets source"],
    },
    status: "completed",
  },
  {
    id: "command",
    type: "commandExecution",
    command: "node --version",
    aggregatedOutput: "v24.16.0\n",
    exitCode: 0,
    status: "completed",
  },
  {
    id: "files",
    type: "fileChange",
    changes: [
      { path: "note.md", kind: { type: "update" }, diff: "+confirmed\n" },
    ],
    status: "completed",
  },
  {
    id: "child",
    type: "collabAgentToolCall",
    tool: "spawnAgent",
    senderThreadId: "main",
    receiverThreadIds: ["child-thread"],
    agentsStates: {
      "child-thread": { status: "completed", message: "Checked" },
    },
    status: "completed",
  },
  { id: "answer", type: "agentMessage", text: "Confirmed" },
];
