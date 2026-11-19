import type { Bot, BotPresence } from "@domos/agent/bots";
import type { Team } from "@domos/agent/teams";
import {
  avatarImageStatus,
  characterImages,
  retryAvatarImages,
  useAvatarImages,
} from "@domos/ui/avatar";
import { characterIdentity } from "@domos/ui/characters";
import { metrics } from "@domos/ui/tokens";
import { useEffect, useMemo, useState } from "react";
import { useErrorNotice } from "../notices.tsx";

export function useWorkspaceAvatars(
  selected: Bot | undefined,
  items: BotPresence[],
  teams: Team[],
  selectedTeam: Team | undefined,
) {
  const [entered, setEntered] = useState(false);
  const [coverBudgetUsed, setCoverBudgetUsed] = useState(false);
  const { bodies, covers } = useMemo(() => {
    if (!selected) return { bodies: [], covers: [] };
    const rem = Number.parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    const rows = Math.ceil(
      window.innerHeight / (rem * Number.parseFloat(metrics["contact-height"])),
    );
    const members = new Set([
      ...(selectedTeam?.members ?? []),
      ...teams
        .slice(0, Math.max(0, rows - items.length))
        .flatMap((team) => team.members),
    ]);
    const visible = [
      selected,
      ...items.filter((bot, index) => index < rows || members.has(bot.id)),
    ];
    const bodies = new Set(
      visible.flatMap((bot) =>
        characterImages(characterIdentity(bot.avatar).shape, true),
      ),
    );
    return {
      bodies: [...bodies],
      covers: [
        ...new Set(
          visible.flatMap((bot) =>
            bot.avatarMedia ? [bot.avatarMedia.cover] : [],
          ),
        ),
      ],
    };
  }, [selected, items, teams, selectedTeam]);
  const bodyStatus = useAvatarImages(bodies);
  useAvatarImages(covers);
  const coversPending = covers.some((url) => {
    const status = avatarImageStatus(url);
    return !status || status === "loading";
  });
  const failedCover = covers.find((url) => avatarImageStatus(url) === "failed");
  useErrorNotice(
    failedCover ? "自定义头像读取失败，已显示内置角色。" : undefined,
    () => {
      if (failedCover) retryAvatarImages([failedCover]);
    },
  );
  useEffect(() => {
    if (entered || !coversPending || coverBudgetUsed) return;
    const timer = window.setTimeout(() => setCoverBudgetUsed(true), 250);
    return () => window.clearTimeout(timer);
  }, [entered, coversPending, coverBudgetUsed]);
  const ready = bodyStatus === "ready" && (!coversPending || coverBudgetUsed);
  useEffect(() => {
    if (selected && ready) setEntered(true);
  }, [selected, ready]);
  return {
    waiting: !entered && !ready,
    failed: !entered && bodyStatus === "failed",
    retry: () => retryAvatarImages(bodies),
  };
}
