import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../src/client.ts", () => ({ computerScope: "computer-a" }));

import * as scope from "../src/client.ts";
import {
  readingPosition,
  saveReadingPosition,
} from "../src/features/chat/reading-position.ts";
import {
  saveWorkspaceView,
  workspaceView,
} from "../src/features/shell/workspace-state.ts";

beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  Object.assign(scope, { computerScope: "computer-a" });
});

test("computer identity separates same-ID contacts, panels and reading anchors", () => {
  saveWorkspaceView({
    contact: "#bot/1/20",
    conversations: { "1": 20 },
    expandedBots: { "1": true },
    panels: { "1": { open: true, tab: "work", detail: "root" } },
  });
  const anchor = {
    key: "message:one",
    cursor: "25:0",
    offset: -12,
    following: false,
  };
  saveReadingPosition("1", anchor);
  Object.assign(scope, { computerScope: "computer-b" });
  expect(workspaceView()).toEqual({
    panels: {},
    conversations: {},
    expandedBots: {},
  });
  expect(readingPosition("1")).toBeUndefined();
  saveWorkspaceView({ contact: "#bot/2" });
  Object.assign(scope, { computerScope: "computer-a" });
  expect(workspaceView()).toMatchObject({
    contact: "#bot/1/20",
    conversations: { "1": 20 },
    expandedBots: { "1": true },
    panels: { "1": { tab: "work" } },
  });
  expect(readingPosition("1")).toEqual(anchor);
  expect(readingPosition("team:1")).toBeUndefined();
});

test("damaged and unavailable client storage keeps navigation usable", () => {
  localStorage.setItem("domos:workspace:v1:computer-a", "broken");
  localStorage.setItem("domos:reading:v1:computer-a:1", '{"cursor":"bad"}');
  expect(workspaceView()).toEqual({
    panels: {},
    conversations: {},
    expandedBots: {},
  });
  expect(readingPosition("1")).toBeUndefined();
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("Blocked");
    },
    setItem: () => {
      throw new Error("Blocked");
    },
  });
  expect(() => saveWorkspaceView({ contact: "#bot/1" })).not.toThrow();
  expect(workspaceView()).toEqual({
    panels: {},
    conversations: {},
    expandedBots: {},
  });
});
