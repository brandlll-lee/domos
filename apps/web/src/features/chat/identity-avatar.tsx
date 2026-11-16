import type { Bot } from "@domos/agent/bots";
import { BotAvatar } from "@domos/ui/avatar";
import { type CharacterWork, WorkBurst } from "@domos/ui/character-work";
import { characterIdentity } from "@domos/ui/characters";
import { useEffect, useRef, useState } from "react";

function identity(bot: Bot) {
  return JSON.stringify([
    bot.name,
    bot.avatarMedia?.src ?? characterIdentity(bot.avatar).shape,
  ]);
}
export function IdentityAvatar({
  bot,
  busy,
  work,
}: {
  bot: Bot;
  busy: boolean;
  work: CharacterWork;
}) {
  const [view, setView] = useState(bot);
  const [changing, setChanging] = useState(false);
  const accepted = useRef(identity(bot));
  const burst = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const next = identity(bot);
    if (accepted.current === next) {
      setView(bot);
      return;
    }
    let cancelled = false;
    let frame = 0;
    const immediate = () => {
      accepted.current = next;
      setView(bot);
      setChanging(false);
    };
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    if (document.hidden || motion.matches) {
      immediate();
      return;
    }
    const settle = () => {
      if (document.hidden || motion.matches) {
        cancelled = true;
        cancelAnimationFrame(frame);
        immediate();
      }
    };
    document.addEventListener("visibilitychange", settle);
    motion.addEventListener("change", settle);
    void (async () => {
      if (bot.avatarMedia) {
        const image = new Image();
        image.src = bot.avatarMedia.cover;
        try {
          await image.decode();
        } catch {
          if (!cancelled) immediate();
          return;
        }
      }
      if (cancelled) return;
      setChanging(true);
      const tick = () => {
        if (cancelled) return;
        const animation = burst.current
          ?.querySelector(".character-work-cloud")
          ?.getAnimations()[0];
        const duration = animation?.effect?.getComputedTiming().activeDuration;
        // Swap beneath the expanding cloud, using its existing animation timeline.
        if (
          animation &&
          typeof duration === "number" &&
          Number(animation.currentTime) >= duration * 0.3
        ) {
          accepted.current = next;
          setView(bot);
          return;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", settle);
      motion.removeEventListener("change", settle);
    };
  }, [bot]);
  return (
    <span className="identity-avatar" data-changing={changing || undefined}>
      <BotAvatar
        seed={view.avatar}
        media={view.avatarMedia}
        state={busy ? "running" : "idle"}
        work={work}
      />
      {changing && (
        <svg
          ref={burst}
          className="character identity-burst"
          viewBox="0 0 100 100"
          data-entering="true"
          aria-hidden="true"
          onAnimationEnd={(event) => {
            if (event.animationName === "character-work-poof") {
              accepted.current = identity(bot);
              setView(bot);
              setChanging(false);
            }
          }}
        >
          <WorkBurst color={characterIdentity(bot.avatar).color} />
        </svg>
      )}
    </span>
  );
}
