import type { Bot, BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { client } from "../../client.ts";
import {
  clearConnections,
  invalidateNativeConnections,
} from "../apps/connection-state.ts";
import { clearChatState } from "../chat/use-chat.ts";
import { clearDraftState } from "../chat/use-draft.ts";
import { clearTranscriptPositions } from "../chat/use-transcript.ts";
import { receiveConnection, useConnection } from "../connection.ts";
import { clearFiles } from "../files/file-state.ts";
import {
  clearModelSettings,
  invalidateModelSettings,
  receiveModelActivity,
} from "../models/model-state.ts";
import { useErrorNotice } from "../notices.tsx";
import {
  clearImageSettings,
  invalidateImageSettings,
} from "../settings/image-state.ts";
import {
  clearConnectionContexts,
  invalidateConnectionContext,
} from "../settings/use-connection-context.ts";
import { saveWorkspaceView, workspaceView } from "../shell/workspace-state.ts";
import { invalidateQuota } from "../usage/quota-state.ts";
import { invalidateCharacters, receiveCharacter } from "./character-state.ts";
import {
  clearBotWork,
  invalidateBotWork,
  receiveBotProfile,
} from "./details/use-bot-work.ts";

function subscribeLocation(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export const selectBot = (bot: Bot) => {
  window.location.hash = `bot/${bot.id}`;
};

export function useBots() {
  const connection = useConnection();
  const activity = useRef(new Map<number, boolean>());
  const bindings = useRef<Record<string, string>>({});
  const [items, setItems] = useState<BotPresence[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [computers, updateComputers] = useState<
    Awaited<ReturnType<typeof client.computer.list>>
  >({ items: [], defaultId: null, bindings: {} });
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hash = useSyncExternalStore(
    subscribeLocation,
    () => window.location.hash || workspaceView().contact || "",
  );
  useEffect(() => {
    if (/^#(?:bot\/\d+|team\/.+)$/.test(hash))
      saveWorkspaceView({ contact: hash });
  }, [hash]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const events = await client.teams.subscribe(undefined, {
          signal: controller.signal,
          context: { retry: Number.POSITIVE_INFINITY },
        });
        for await (const next of events) {
          if (controller.signal.aborted) return;
          setTeams(next);
        }
      } catch {
        if (!controller.signal.aborted) setError("团队加载失败。请刷新重试。");
      }
    })();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const events = await client.bots.subscribe(undefined, {
          signal: controller.signal,
          context: {
            retry: Number.POSITIVE_INFINITY,
            onRetry: () => {
              if (!controller.signal.aborted) {
                setConnected(false);
                receiveConnection({ connected: false });
              }
            },
          },
        });
        for await (const next of events) {
          if (controller.signal.aborted) return;
          const ids = new Set(next.items.map((bot) => bot.id));
          clearChatState(ids);
          clearDraftState(ids);
          clearBotWork(ids);
          clearConnections(ids);
          clearFiles(ids);
          clearModelSettings(ids);
          clearImageSettings(ids);
          clearConnectionContexts(ids);
          for (const bot of next.items) {
            receiveCharacter(bot);
            receiveBotProfile(bot);
            receiveModelActivity(bot.id, bot.busy);
            if (activity.current.get(bot.id) && !bot.busy) invalidateQuota();
            activity.current.set(bot.id, bot.busy);
            const binding = next.bindings[String(bot.id)];
            const key = JSON.stringify([
              binding?.computerId ?? next.defaultComputerId,
              binding?.directory,
            ]);
            const previous = bindings.current[bot.id];
            if (previous !== undefined && previous !== key) {
              invalidateCharacters(bot.id);
              invalidateNativeConnections(bot.id);
              invalidateBotWork(bot.id);
              invalidateModelSettings(bot.id);
              invalidateImageSettings(bot.id);
              invalidateConnectionContext(bot.id);
              invalidateQuota();
            }
            bindings.current[bot.id] = key;
          }
          clearTranscriptPositions(ids);
          setItems(next.items);
          updateComputers({
            items: next.computers,
            defaultId: next.defaultComputerId,
            bindings: next.bindings,
          });
          setConnected(true);
          receiveConnection({ connected: true });
          setError(null);
        }
      } catch {
        if (!controller.signal.aborted)
          setError("联系人加载失败。请刷新重试。");
      } finally {
        if (!controller.signal.aborted) {
          setConnected(false);
          receiveConnection({ connected: false });
        }
      }
    })();
    return () => controller.abort();
  }, []);
  useErrorNotice(error);
  const match = /^#bot\/(\d+)$/.exec(hash);
  const selectedTeam = teams.find((team) => hash === `#team/${team.id}`);
  const selected =
    items.find(
      (bot) => bot.id === (selectedTeam?.owner ?? Number(match?.[1])),
    ) ?? items[0];
  return {
    items,
    teams,
    setTeams,
    selectedTeam,
    selected,
    error,
    connected:
      connected && (!connection.service || connection.service === "ready"),
    computers,
    updateComputers,
  };
}
