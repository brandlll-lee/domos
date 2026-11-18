import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { brandCharacter, type CharacterShape } from "../characters.ts";
import { Character } from "./character.tsx";
import { animateCharacter } from "./character-motion.ts";
import { Button } from "./controls.tsx";
import "./startup.css";

export function StartupLoading({
  message,
  children,
}: {
  message: string;
  children?: ReactNode;
}) {
  const work = useId();
  return (
    <main className="startup-loading" aria-label="本机后台准备">
      <div className="startup-crt">
        <div className="startup-glass">
          <div className="startup-pixel-bot">
            <Character
              {...brandCharacter}
              state="running"
              work={{ id: work, working: true }}
            />
          </div>
          <div role="status" className="startup-readiness">
            <span className="startup-spinner" aria-hidden="true" />
            <span>{message}</span>
          </div>
        </div>
      </div>
      {children && <div className="startup-loading-actions">{children}</div>}
    </main>
  );
}

const appearances = [
  brandCharacter,
  { shape: "bunny", color: "#f69dd1" },
  { shape: "sprout", color: "#91df74" },
  { shape: "cloud", color: "#7bc6ff" },
  { shape: "star", color: "#f8bd3e" },
] satisfies { shape: CharacterShape; color: string }[];

function GuideBot() {
  const id = useId();
  const [appearance, setAppearance] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const character = appearances[appearance] ?? brandCharacter;
  useEffect(() => {
    if (button.current)
      return animateCharacter(button.current, character.shape);
  }, [character.shape]);
  return (
    <Button
      ref={button}
      variant="ghost"
      className="startup-guide-bot"
      aria-label="随机变身"
      onClick={() =>
        setAppearance(
          (previous) =>
            (previous +
              1 +
              Math.floor(Math.random() * (appearances.length - 1))) %
            appearances.length,
        )
      }
    >
      <span className="character-gesture">
        <Character
          {...character}
          state="running"
          work={{ id: `${id}:${appearance}`, working: true }}
        />
      </span>
    </Button>
  );
}

export function StartupScene({
  title,
  signal,
  description,
  children,
  back,
  footer,
}: {
  title: string;
  signal: string;
  description?: string;
  children: ReactNode;
  back?: () => void;
  footer?: ReactNode;
}) {
  const focusHeading = useCallback((heading: HTMLHeadingElement | null) => {
    heading?.focus({ preventScroll: true });
  }, []);
  const label = useId();
  return (
    <main className="startup-guide" aria-labelledby={label}>
      <div className="startup-scene" key={title}>
        <div className="startup-computer">
          {back && (
            <Button
              variant="ghost"
              className="startup-return-wire"
              aria-label="沿线返回"
              onClick={back}
            >
              <span aria-hidden="true">←</span>
            </Button>
          )}
          <div className="startup-crt">
            <div className="startup-glass">
              <div className="startup-screen-copy">
                <span className="startup-signal" aria-hidden="true">
                  {signal}
                </span>
                <h1 id={label} ref={focusHeading} tabIndex={-1}>
                  {title}
                </h1>
                {description && <p>{description}</p>}
              </div>
            </div>
          </div>
          <GuideBot />
        </div>
        <div className="startup-station">{children}</div>
      </div>
      {(back || footer) && (
        <footer className="startup-footer">
          {back && (
            <Button variant="ghost" onClick={back}>
              <span aria-hidden="true">←</span> 返回
            </Button>
          )}
          {footer}
        </footer>
      )}
    </main>
  );
}
